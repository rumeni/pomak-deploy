"""Retention for PostgreSQL-backed, cross-instance authentication throttle buckets."""

from datetime import timedelta

from django.utils import timezone

from .models import AuthThrottleBucket

# The deletion-password throttle uses 1-hour windows. Keeping two hours makes
# retention comfortably longer than every active 1-minute / 1-hour window.
RETENTION_HOURS = 2
BATCH_SIZE = 3000
MAX_BATCHES = 50


def cleanup_expired_auth_throttle_buckets(*, now=None, batch_size=BATCH_SIZE, max_batches=MAX_BATCHES):
    """Delete expired buckets in bounded batches to avoid a long DB transaction.

    Safe with concurrent logins: their keys use the *current* minute/hour.
    Returns (deleted_rows, remaining_expired_rows), where the second value
    indicates whether the next scheduled run should continue cleanup.
    """
    if batch_size < 1 or max_batches < 1:
        raise ValueError('batch_size and max_batches must be positive')
    cutoff = (now or timezone.now()) - timedelta(hours=RETENTION_HOURS)
    expired = AuthThrottleBucket.objects.filter(window_start__lt=cutoff)
    deleted = 0
    for _ in range(max_batches):
        ids = list(expired.order_by('pk').values_list('pk', flat=True)[:batch_size])
        if not ids:
            return deleted, False
        count, _ = AuthThrottleBucket.objects.filter(pk__in=ids, window_start__lt=cutoff).delete()
        deleted += count
        if len(ids) < batch_size:
            return deleted, False
    return deleted, expired.exists()
