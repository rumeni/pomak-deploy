"""Push notifications: Web Push (RFC 8030/8291/8292, VAPID) and Android FCM HTTP v1.

Configuration comes from environment variables; without them nothing is sent and the app works
as before (the API reports which channels are available):

- WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY (base64url, see `generate_vapid_keys`)
  and WEB_PUSH_CONTACT (a mailto: or https: URL the push services can reach the operator at);
- FCM_SERVICE_ACCOUNT: the Firebase service account JSON (or that JSON base64-encoded).

A notification never contains message text or health data: only who did what, and where it
opens. It is sent after the database commit, with short timeouts; failures are logged and never
fail the request. Devices the push service reports as gone are removed.
"""

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.db import transaction
from django.utils import translation

from .models import PushDevice

logger = logging.getLogger(__name__)
TIMEOUT = 4
MAX_DEVICES_PER_SEND = 5


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


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


def send_web(device, payload: dict) -> bool:
    """False when the subscription is gone (the device is removed)."""
    if not urllib.parse.urlsplit(device.token).scheme == 'https':
        return False
    body = encrypt(json.dumps(payload).encode(), device.p256dh, device.auth)
    request = urllib.request.Request(device.token, data=body, method='POST', headers={
        'Authorization': vapid_header(device.token), 'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream', 'TTL': '86400', 'Urgency': 'normal',
        'Topic': payload.get('tag', '')[:32] or 'pomak',
    })
    try:
        urllib.request.urlopen(request, timeout=TIMEOUT).close()
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            return False
        logger.warning('web push failed: %s', error.code)
    return True


# ---- FCM ------------------------------------------------------------------------------------

_fcm_token = {'value': None, 'expires': 0.0}


def fcm_access_token(account) -> str:
    if _fcm_token['value'] and _fcm_token['expires'] > time.time() + 60:
        return _fcm_token['value']
    now = int(time.time())
    assertion = jwt.encode({
        'iss': account['client_email'], 'scope': 'https://www.googleapis.com/auth/firebase.messaging',
        'aud': account.get('token_uri', 'https://oauth2.googleapis.com/token'), 'iat': now, 'exp': now + 3600,
    }, account['private_key'], algorithm='RS256')
    body = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}).encode()
    request = urllib.request.Request(account.get('token_uri', 'https://oauth2.googleapis.com/token'), data=body, method='POST')
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        data = json.load(response)
    _fcm_token.update(value=data['access_token'], expires=time.time() + int(data.get('expires_in', 3600)))
    return _fcm_token['value']


def send_fcm(device, payload: dict) -> bool:
    account = fcm_account()
    if account is None:
        return True
    message = {'message': {
        'token': device.token,
        'notification': {'title': payload['title'], 'body': payload['body']},
        'data': {'url': payload['url']},
        'android': {'priority': 'high', 'notification': {'tag': payload.get('tag', 'pomak')}},
    }}
    request = urllib.request.Request(
        f"https://fcm.googleapis.com/v1/projects/{account['project_id']}/messages:send",
        data=json.dumps(message).encode(), method='POST',
        headers={'Authorization': f'Bearer {fcm_access_token(account)}', 'Content-Type': 'application/json'},
    )
    try:
        urllib.request.urlopen(request, timeout=TIMEOUT).close()
    except urllib.error.HTTPError as error:
        if error.code == 404 or b'UNREGISTERED' in (error.read() or b''):
            return False
        logger.warning('fcm push failed: %s', error.code)
    return True


# ---- sending --------------------------------------------------------------------------------

def deliver(user_id, payload: dict) -> None:
    devices = list(PushDevice.objects.filter(user_id=user_id)[:MAX_DEVICES_PER_SEND])
    gone = []
    for device in devices:
        try:
            if device.kind == PushDevice.Kind.WEB and web_push_enabled():
                alive = send_web(device, payload)
            elif device.kind == PushDevice.Kind.FCM and fcm_enabled():
                alive = send_fcm(device, payload)
            else:
                continue
        except Exception:  # a push never breaks the request that caused it
            logger.exception('push delivery failed')
            continue
        if not alive:
            gone.append(device.pk)
    if gone:
        PushDevice.objects.filter(pk__in=gone).delete()


def notify(user, *, title, body, url, tag) -> None:
    """Send after the current transaction commits, in the recipient's language.

    `title` and `body` are lazy translations (or callables returning text) evaluated in that
    language; nothing is sent if the transaction rolls back or the user has no device.
    """
    if not (web_push_enabled() or fcm_enabled()):
        return
    if not PushDevice.objects.filter(user=user).exists():
        return
    language = getattr(getattr(user, 'profile', None), 'language', None) or 'sr-latn'
    with translation.override(language):
        payload = {
            'title': str(title() if callable(title) else title)[:120],
            'body': str(body() if callable(body) else body)[:200],
            'url': url, 'tag': tag,
        }
    transaction.on_commit(lambda: deliver(user.pk, payload))
