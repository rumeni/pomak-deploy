"""Registrations are named by their attempt, and revoking one is final for that attempt."""

from django.db import connection, transaction

from .models import PushDevice, PushRevocation

ATTEMPT_LOCK = 7302  # advisory lock class: one push registration attempt


def _lock(attempt):
    value = attempt.int & 0xFFFFFFFF
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(%s, %s)', [ATTEMPT_LOCK, value - (1 << 32) if value >= (1 << 31) else value])


def register(user, attempt, **fields) -> bool:
    """Register (or move) the device for this attempt; False if the attempt was already revoked
    (its sign-out or abort arrived first). `attempt` None: an older app (a legacy row)."""
    with transaction.atomic():
        if attempt is not None:
            _lock(attempt)
            if PushRevocation.objects.filter(attempt=attempt).exists():
                return False
        PushDevice.objects.update_or_create(token=fields.pop('token'), defaults={'user': user, 'attempt': attempt, **fields})
    return True


def remove_legacy(user_id, token) -> None:
    """An older app (or a device not yet upgraded) removing its registration by token: only a
    legacy row, never a newer registration with an attempt that uses the same token."""
    if user_id and isinstance(token, str) and 0 < len(token) <= 2000:
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
