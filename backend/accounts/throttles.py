"""PostgreSQL-backed auth throttling shared by all Vercel Python instances."""

import hashlib
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.throttling import BaseThrottle

from .models import AuthThrottleBucket


class DatabaseAuthThrottle(BaseThrottle):
    """Enforce account and IP quotas atomically across serverless instances.

    The account limit is the primary defence against distributed guessing.
    Proxy IP limits are supplemental and conservative to avoid penalizing NATs.
    """

    def allow_request(self, request, view):
        if request.method != 'POST':
            return True
        now = timezone.now()
        bucket_start = now.replace(second=0, microsecond=0)
        email = str(request.data.get('email', '')).strip().casefold() if isinstance(request.data, dict) else ''
        # Never trust arbitrary user-provided X-Forwarded-For values as a throttle bypass.
        ip = str(request.META.get('REMOTE_ADDR', 'unknown'))
        limits = [('ip', ip, 120)]
        if email:
            limits.append(('account', email, 10))
        for kind, identity, limit in limits:
            key = hashlib.sha256(f'{kind}:{identity}'.encode('utf-8')).hexdigest()
            with transaction.atomic():
                bucket, _ = AuthThrottleBucket.objects.get_or_create(
                    key=key, window_start=bucket_start, defaults={'attempts': 0},
                )
                AuthThrottleBucket.objects.filter(pk=bucket.pk).update(attempts=F('attempts') + 1)
                bucket.refresh_from_db(fields=['attempts'])
                if bucket.attempts > limit:
                    self.remaining = max(1, int((bucket_start + timedelta(minutes=1) - now).total_seconds()))
                    return False
        return True

    def wait(self):
        return getattr(self, 'remaining', 60)
