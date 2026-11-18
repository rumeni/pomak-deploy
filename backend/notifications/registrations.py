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
    (its sign-out or abort arrived first)."""
    with transaction.atomic():
        _lock(attempt)
        if PushRevocation.objects.filter(attempt=attempt).exists():
            return False
        PushDevice.objects.update_or_create(token=fields.pop('token'), defaults={'user': user, 'attempt': attempt, **fields})
    return True


def revoke(user_id, attempt) -> None:
    """Undo exactly this attempt for this account, whichever arrives first."""
    with transaction.atomic():
        _lock(attempt)
        PushRevocation.objects.get_or_create(attempt=attempt, defaults={'user_id': user_id})
        PushDevice.objects.filter(user_id=user_id, attempt=attempt).delete()
