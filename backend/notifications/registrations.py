"""Registrations are named by their attempt, and revoking one is final for that attempt."""

import hashlib

from django.db import connection, transaction

from .models import PushDevice, PushRevocation

ATTEMPT_LOCK = 7302  # advisory lock class: one push registration attempt
TOKEN_LOCK = 7303  # advisory lock class: one device token (all registrations of it)


def _advisory(lock_class, value):
    value &= 0xFFFFFFFF
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(%s, %s)', [lock_class, value - (1 << 32) if value >= (1 << 31) else value])


def _lock(attempt):
    _advisory(ATTEMPT_LOCK, attempt.int)


def _lock_token(token):
    # Also when no row exists yet: two first registrations of one device wait for each other.
    _advisory(TOKEN_LOCK, int.from_bytes(hashlib.sha256(token.encode()).digest()[:4], 'big'))


def register(user, attempt, **fields) -> bool:
    """Register (or move) the device for this attempt; False if the attempt was already revoked
    (its sign-out or abort arrived first). `attempt` None: an older app (a legacy row)."""
    token = fields.pop('token')
    with transaction.atomic():
        # Every registration of this token, old app or new, in turn (always token, then attempt).
        _lock_token(token)
        if attempt is not None:
            _lock(attempt)
            if PushRevocation.objects.filter(attempt=attempt).exists():
                return False
        else:
            # A legacy registration (an older app, possibly a delayed request) never replaces one
            # made with an attempt: that newer registration stays exactly as it is.
            existing = PushDevice.objects.filter(token=token).first()
            if existing is not None and existing.attempt is not None:
                return True
        PushDevice.objects.update_or_create(token=token, defaults={'user': user, 'attempt': attempt, **fields})
    return True


def remove_legacy(user_id, token) -> None:
    """An older app (or a device not yet upgraded) removing its registration by token: only a
    legacy row, never a newer registration with an attempt that uses the same token."""
    if user_id and isinstance(token, str) and 0 < len(token) <= 2000:
        with transaction.atomic():
            _lock_token(token)
            PushDevice.objects.filter(user_id=user_id, token=token, attempt__isnull=True).delete()


def revoke(user_id, attempt) -> None:
    """Undo exactly this attempt for this account, whichever arrives first. Unknown accounts are
    ignored (no tombstone)."""
    from django.contrib.auth import get_user_model

    if not get_user_model().objects.filter(pk=user_id).exists():
        return
    with transaction.atomic():
        _lock(attempt)
        PushRevocation.objects.get_or_create(attempt=attempt, defaults={'user_id': user_id})
        PushDevice.objects.filter(user_id=user_id, attempt=attempt).delete()
