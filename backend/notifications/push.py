"""Push notifications: Web Push (RFC 8030/8291/8292, VAPID) and Android FCM HTTP v1.

Configuration comes from environment variables; without them nothing is queued or sent and the
app works as before (the API reports which channels are available):

- WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY (base64url, see `generate_vapid_keys`)
  and WEB_PUSH_CONTACT (a mailto: or https: URL the push services can reach the operator at);
- FCM_SERVICE_ACCOUNT: the Firebase service account JSON (or that JSON base64-encoded);
- PUSH_WORKER_URL (+ the QStash token and signing keys already used for e-mail): delivery runs in
  a signed QStash callback instead of the request that caused it.

Delivery is durable and bounded. `notify` stores a `PushMessage` in the same transaction as the
event (nothing is queued if it rolls back). After the commit, one QStash message asks the worker
to drain the queue; without QStash a short, time-boxed drain runs right after the commit. Every
drain has a deadline, sends to all of a user's devices in parallel with short timeouts, and drops
messages older than an hour (a late "new message" is noise).

A notification never contains message text, exercise names or health data: only who did what and
where it opens. Web push goes only to the push services of real browsers (no other hosts, no
redirects), so a registered "subscription" can never make this server call anywhere else.
"""

import base64
import contextvars
import json
import logging
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import timedelta

import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone, translation

from .models import PushDevice, PushMessage

logger = logging.getLogger(__name__)
TIMEOUT = 4
MAX_AGE = timedelta(hours=1)
MAX_ATTEMPTS = 3
RETRY_DELAY = timedelta(seconds=30)
# The whole hand-off after a request (publish to QStash, or a short drain here) stays under this.
KICK_BUDGET = 3.0
WORKER_BUDGET = 7.0

# The push services of real browsers. A web push endpoint must be https on the default port at
# one of these hosts (or a subdomain of the suffixes).
PUSH_HOSTS = {'fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'}
PUSH_HOST_SUFFIXES = ('.notify.windows.com', '.push.apple.com')


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


def allowed_endpoint(endpoint: str) -> bool:
    try:
        parts = urllib.parse.urlsplit(endpoint)
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or '').lower()
    return (
        parts.scheme == 'https' and port in (None, 443) and not parts.username and not parts.password
        and not host.endswith('.')
        and (host in PUSH_HOSTS or any(host.endswith(s) and len(host) > len(s) for s in PUSH_HOST_SUFFIXES))
    )


def valid_keys(p256dh: str, auth: str) -> bool:
    """The browser's key must be a point on P-256 and the auth secret 16 bytes."""
    try:
        point = b64url_decode(p256dh)
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), point)
        return len(point) == 65 and len(b64url_decode(auth)) == 16
    except (ValueError, TypeError):
        return False


# ---- configuration --------------------------------------------------------------------------

def vapid_public_key():
    return os.environ.get('WEB_PUSH_VAPID_PUBLIC_KEY', '').strip() or None


def web_push_enabled() -> bool:
    return bool(vapid_public_key() and os.environ.get('WEB_PUSH_VAPID_PRIVATE_KEY', '').strip())


def fcm_account():
    raw = os.environ.get('FCM_SERVICE_ACCOUNT', '').strip()
    if not raw:
        return None
    try:
        return json.loads(raw if raw.startswith('{') else base64.b64decode(raw))
    except (ValueError, TypeError):
        logger.error('FCM_SERVICE_ACCOUNT is not valid JSON')
        return None


def fcm_enabled() -> bool:
    return fcm_account() is not None


def push_enabled() -> bool:
    return web_push_enabled() or fcm_enabled()


def worker_url() -> str:
    return os.environ.get('PUSH_WORKER_URL', '').strip()


def queue_configured() -> bool:
    return bool(worker_url() and settings.QSTASH_TOKEN and settings.QSTASH_CURRENT_SIGNING_KEY and settings.QSTASH_NEXT_SIGNING_KEY)


# ---- HTTP without redirects -----------------------------------------------------------------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # a 3xx is returned as an error, never followed


_opener = urllib.request.build_opener(_NoRedirect)


def http_post(request, timeout):
    return _opener.open(request, timeout=timeout)


# ---- web push -------------------------------------------------------------------------------

def encrypt(payload: bytes, p256dh: str, auth: str) -> bytes:
    """aes128gcm content encoding for one push message (RFC 8291), one record."""
    ua_public = b64url_decode(p256dh)
    auth_secret = b64url_decode(auth)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    as_private = ec.generate_private_key(ec.SECP256R1())
    as_public = as_private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = as_private.exchange(ec.ECDH(), ua_key)
    ikm = HKDF(hashes.SHA256(), 32, salt=auth_secret, info=b'WebPush: info\x00' + ua_public + as_public).derive(shared)
    salt = os.urandom(16)
    cek = HKDF(hashes.SHA256(), 16, salt=salt, info=b'Content-Encoding: aes128gcm\x00').derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt=salt, info=b'Content-Encoding: nonce\x00').derive(ikm)
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b'\x02', None)
    return salt + (4096).to_bytes(4, 'big') + bytes([len(as_public)]) + as_public + ciphertext


def vapid_header(endpoint: str) -> str:
    parts = urllib.parse.urlsplit(endpoint)
    private_number = int.from_bytes(b64url_decode(os.environ['WEB_PUSH_VAPID_PRIVATE_KEY'].strip()), 'big')
    key = ec.derive_private_key(private_number, ec.SECP256R1())
    token = jwt.encode({
        'aud': f'{parts.scheme}://{parts.netloc}', 'exp': int(time.time()) + 12 * 3600,
        'sub': os.environ.get('WEB_PUSH_CONTACT', '').strip() or 'mailto:push@pomak.invalid',
    }, key, algorithm='ES256')
    return f'vapid t={token}, k={vapid_public_key()}'


DELIVERED, GONE, RETRY = 'delivered', 'gone', 'retry'


def _http_outcome(code: int) -> str:
    """Rate limits and server errors are temporary; other refusals are final (no retry)."""
    return RETRY if code == 429 or code >= 500 else DELIVERED


def send_web(device, payload: dict, deadline: float) -> str:
    """GONE when the subscription is gone or not allowed (the device is removed)."""
    if not allowed_endpoint(device.token) or not valid_keys(device.p256dh, device.auth):
        return GONE
    body = encrypt(json.dumps(payload).encode(), device.p256dh, device.auth)
    request = urllib.request.Request(device.token, data=body, method='POST', headers={
        'Authorization': vapid_header(device.token), 'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream', 'TTL': '3600', 'Urgency': 'normal',
        'Topic': ''.join(c for c in payload.get('tag', '') if c.isalnum() or c in '-_')[:32] or 'pomak',
    })
    try:
        http_post(request, min(TIMEOUT, time_left(deadline))).close()
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            return GONE
        logger.warning('web push failed: %s', error.code)
        return _http_outcome(error.code)
    return DELIVERED


# ---- FCM ------------------------------------------------------------------------------------

_fcm_token = {'value': None, 'expires': 0.0}
_fcm_lock = threading.Lock()


class DeadlinePassed(Exception):
    """No time left for this attempt: it is retried later, never waited for."""


def time_left(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0.05:
        raise DeadlinePassed()
    return remaining


def fcm_access_token(account, deadline: float) -> str:
    # Waiting for another thread's token request counts against the same deadline.
    if not _fcm_lock.acquire(timeout=time_left(deadline)):
        raise DeadlinePassed()
    try:
        if _fcm_token['value'] and _fcm_token['expires'] > time.time() + 60:
            return _fcm_token['value']
        now = int(time.time())
        token_uri = 'https://oauth2.googleapis.com/token'
        assertion = jwt.encode({
            'iss': account['client_email'], 'scope': 'https://www.googleapis.com/auth/firebase.messaging',
            'aud': token_uri, 'iat': now, 'exp': now + 3600,
        }, account['private_key'], algorithm='RS256')
        body = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}).encode()
        request = urllib.request.Request(token_uri, data=body, method='POST')
        with http_post(request, min(TIMEOUT, time_left(deadline))) as response:
            data = json.load(response)
        _fcm_token.update(value=data['access_token'], expires=time.time() + int(data.get('expires_in', 3600)))
        return _fcm_token['value']
    finally:
        _fcm_lock.release()


def send_fcm(device, payload: dict, deadline: float) -> str:
    account = fcm_account()
    if account is None:
        return DELIVERED
    message = {'message': {
        'token': device.token,
        'notification': {'title': payload['title'], 'body': payload['body']},
        'data': {'url': payload['url']},
        'android': {'priority': 'high', 'ttl': '3600s', 'notification': {'tag': payload.get('tag', 'pomak')}},
    }}
    access = fcm_access_token(account, deadline)
    request = urllib.request.Request(
        f"https://fcm.googleapis.com/v1/projects/{urllib.parse.quote(str(account['project_id']), safe='')}/messages:send",
        data=json.dumps(message).encode(), method='POST',
        headers={'Authorization': f'Bearer {access}', 'Content-Type': 'application/json'},
    )
    try:
        http_post(request, min(TIMEOUT, time_left(deadline))).close()
    except urllib.error.HTTPError as error:
        if error.code == 404 or b'UNREGISTERED' in (error.read() or b''):
            return GONE
        logger.warning('fcm push failed: %s', error.code)
        return _http_outcome(error.code)
    return DELIVERED


# ---- delivery -------------------------------------------------------------------------------
#
# Best effort, at least once: a retry goes only to the devices without a confirmed delivery, but
# a lost provider answer (or a worker stopped after sending) can still repeat a notification.

def _send_one(device, payload, deadline) -> str:
    try:
        if device.kind == PushDevice.Kind.WEB and web_push_enabled():
            return send_web(device, payload, deadline)
        if device.kind == PushDevice.Kind.FCM and fcm_enabled():
            return send_fcm(device, payload, deadline)
    except DeadlinePassed:
        return RETRY
    except OSError as error:  # timeouts, refused connections, the token service down: temporary
        logger.warning('push delivery failed: %s', type(error).__name__)
        return RETRY
    except Exception:  # one device never breaks the others; a bug is not retried
        logger.exception('push delivery failed')
    return DELIVERED


def deliver(user_id, payload: dict, deadline: float, device_ids=None) -> list:
    """Send to the user's devices at once (only `device_ids` on a retry), never past `deadline`
    (a monotonic time); remove the ones the service says are gone, unless they were registered
    again meanwhile. Returns the IDs of the devices to try again."""
    devices = PushDevice.objects.filter(user_id=user_id)
    if device_ids is not None:
        devices = devices.filter(pk__in=device_ids)
    devices = list(devices)
    if not devices:
        return []
    pool = ThreadPoolExecutor(max_workers=len(devices))
    futures = [pool.submit(_send_one, d, payload, deadline) for d in devices]
    done, _pending = wait(futures, timeout=max(0.0, deadline - time.monotonic()))
    pool.shutdown(wait=False, cancel_futures=True)
    # Not answered in time: tried again later (the socket timeouts end those threads anyway).
    outcomes = [f.result() if f in done else RETRY for f in futures]
    for device, outcome in zip(devices, outcomes):
        if outcome == GONE:
            PushDevice.objects.filter(pk=device.pk, token=device.token, updated_at=device.updated_at).delete()
    return [str(d.pk) for d, outcome in zip(devices, outcomes) if outcome == RETRY]


def next_due():
    """When the queue next has work: None if empty, now if something can go right away."""
    now = timezone.now()
    if PushMessage.objects.filter(Q(claimed_until__isnull=True) | Q(claimed_until__lte=now)).exists():
        return now
    return PushMessage.objects.order_by('claimed_until').values_list('claimed_until', flat=True).first()


def drain(budget: float):
    """Deliver queued messages, never past `budget` seconds from now. Returns `next_due()`."""
    deadline = time.monotonic() + budget
    PushMessage.objects.filter(created_at__lt=timezone.now() - MAX_AGE).delete()
    while deadline - time.monotonic() >= 1.0:
        now = timezone.now()
        with transaction.atomic():
            item = (PushMessage.objects.select_for_update(skip_locked=True)
                    .filter(Q(claimed_until__isnull=True) | Q(claimed_until__lte=now)).order_by('created_at').first())
            if item is None:
                break
            # Claimed, not held: the slow network part runs outside the transaction.
            item.claimed_until = now + timedelta(seconds=60)
            item.attempts += 1
            item.save(update_fields=['claimed_until', 'attempts'])
        try:
            retry = deliver(item.user_id, item.payload, deadline=min(deadline, time.monotonic() + TIMEOUT + 0.5),
                            device_ids=item.devices)
        except Exception:
            logger.exception('push drain failed')
            retry = item.devices if item.devices is not None else [
                str(pk) for pk in PushDevice.objects.filter(user_id=item.user_id).values_list('pk', flat=True)]
        if retry and item.attempts < MAX_ATTEMPTS:
            # Only the devices that did not get it, a little later (the claim doubles as backoff).
            PushMessage.objects.filter(pk=item.pk).update(
                devices=retry, claimed_until=timezone.now() + RETRY_DELAY * item.attempts,
            )
            continue
        PushMessage.objects.filter(pk=item.pk).delete()
    return next_due()


def publish_drain(timeout: float = 3.0, delay: int = 0) -> bool:
    """Ask the QStash worker to drain the queue (after `delay` seconds); False if not accepted."""
    headers = {'Authorization': 'Bearer ' + settings.QSTASH_TOKEN, 'Content-Type': 'application/json', 'Upstash-Retries': '3'}
    if delay > 0:
        headers['Upstash-Delay'] = f'{int(delay)}s'
    request = urllib.request.Request('https://qstash.upstash.io/v2/publish/' + worker_url(), data=b'{}', method='POST', headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, OSError):
        logger.warning('push queue publish failed')
        return False


def schedule_next(due) -> bool:
    """Make sure the worker runs again when the queue next has work (a retry's backoff)."""
    if due is None:
        return True
    delay = max(1, math.ceil((due - timezone.now()).total_seconds()))
    return publish_drain(delay=delay)


# During a request, commits only note that something was queued; the request hands the queue
# over once at its end (PushKickMiddleware). A program assigned to 50 clients commits 50 times
# but kicks once. Outside a request (commands, cron) a commit kicks right away.
_request_state = contextvars.ContextVar('push_request_state', default=None)


def begin_request():
    return _request_state.set({'pending': False})


def end_request(token) -> bool:
    state = _request_state.get()
    _request_state.reset(token)
    return bool(state and state['pending'])


def _committed():
    state = _request_state.get()
    if state is not None:
        state['pending'] = True
    else:
        kick()


def kick() -> None:
    """Hand the queue over after a request, within KICK_BUDGET in total.

    With the QStash worker configured this only publishes (no push service or OAuth call ever
    runs in a user's request); if publishing fails, the messages stay queued for the next hand-off
    (any later event, the unread poll) or the daily cron. Without a worker (development, or not
    yet configured) a short drain runs here, bounded end to end by the same deadline."""
    try:
        if queue_configured():
            publish_drain(timeout=min(2.0, KICK_BUDGET))
            return
        drain(KICK_BUDGET)
    except Exception:
        logger.exception('push kick failed')


def poll_kick() -> None:
    """From the unread poll (every 30 s while the app is open): pick up what a failed hand-off
    left, without adding provider calls to every poll."""
    stuck = PushMessage.objects.filter(created_at__lt=timezone.now() - timedelta(seconds=60)).filter(
        Q(claimed_until__isnull=True) | Q(claimed_until__lte=timezone.now()))
    if not stuck.exists():
        return
    if queue_configured():
        publish_drain(timeout=1.0)
    else:
        drain(1.5)


def notify(user, *, title, body, url, tag) -> None:
    """Queue a notification in the current transaction, in the recipient's language.

    `title` and `body` are lazy translations (or plain text) evaluated in that language; nothing
    is queued if push is off on the server or the user has no device.
    """
    if not push_enabled() or not PushDevice.objects.filter(user=user).exists():
        return
    language = getattr(getattr(user, 'profile', None), 'language', None) or 'sr-latn'
    with translation.override(language):
        payload = {'title': str(title)[:120], 'body': str(body)[:200], 'url': url, 'tag': tag}
    PushMessage.objects.create(user=user, payload=payload)
    transaction.on_commit(_committed)
