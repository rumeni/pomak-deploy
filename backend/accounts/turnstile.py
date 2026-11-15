"""Server-side Turnstile validation for rate-limited login recovery.

A browser token is NEVER trusted without an independent Siteverify call.
"""

import hashlib
import json
import logging
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from .models import AuthThrottleBucket

logger = logging.getLogger(__name__)
SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
LOGIN_ACTION = 'pomak_login_recovery'


def login_recovery_enabled():
    """Fail closed: an incomplete configuration never enables the bypass."""
    return bool(
        getattr(settings, 'TURNSTILE_LOGIN_ENABLED', False)
        and getattr(settings, 'TURNSTILE_SECRET_KEY', '')
        and getattr(settings, 'TURNSTILE_ALLOWED_HOSTNAMES', ())
    )


def verify_login_recovery(token, remote_ip):
    """Validate a single-use challenge and bind it to the expected action/host."""
    if not login_recovery_enabled() or not isinstance(token, str) or not 0 < len(token) <= 2048:
        return False

    payload = urlencode({
        'secret': settings.TURNSTILE_SECRET_KEY,
        'response': token,
        'remoteip': remote_ip,
    }).encode('utf-8')
    request = Request(
        SITEVERIFY_URL, data=payload,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=3) as response:
            if response.status != 200:
                return False
            result = json.load(response)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, TypeError):
        logger.warning('Turnstile Siteverify unavailable or returned invalid data')
        return False

    allowed = {host.strip().lower() for host in settings.TURNSTILE_ALLOWED_HOSTNAMES if host.strip()}
    return (
        isinstance(result, dict)
        and result.get('success') is True
        and result.get('action') == LOGIN_ACTION
        and isinstance(result.get('hostname'), str)
        and result['hostname'].lower() in allowed
    )


def claim_login_recovery_token(token):
    """Atomically consume a Siteverify-accepted token across Vercel instances.

    Cloudflare's replay detection can be eventually consistent under concurrent
    Siteverify requests. Keep a hashed token claim for at least its 5-minute
    validity, using existing PostgreSQL throttle storage and cleanup retention.
    An advisory *transaction* lock closes the first-insert race for a token.
    """
    digest = hashlib.sha256(f'turnstile-recovery:{token}'.encode('utf-8')).digest()
    token_key = digest.hex()
    lock_id = int.from_bytes(digest[:8], byteorder='big', signed=True)
    now = timezone.now()
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s)', [lock_id])
        # The token itself is never retained. Exact window_start records when
        # it was used; existing 2-hour cleanup removes these rows later.
        if AuthThrottleBucket.objects.filter(
            key=token_key,
            window_start__gte=now - timedelta(minutes=5),
        ).exists():
            return False
        AuthThrottleBucket.objects.create(key=token_key, window_start=now, attempts=1)
    return True
