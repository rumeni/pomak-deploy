"""PostgreSQL-backed auth throttling shared by all Vercel Python instances."""

import hashlib
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.throttling import BaseThrottle

from .models import AuthThrottleBucket
from .turnstile import claim_login_recovery_token, login_recovery_enabled, verify_login_recovery


class DatabaseAuthThrottle(BaseThrottle):
    """Atomic, PostgreSQL-backed IP and email quotas across serverless instances."""

    def consume_limit(self, kind, identity, limit, now):
        bucket_start = now.replace(second=0, microsecond=0)
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

    def allow_request(self, request, view):
        if request.method != 'POST':
            return True
        now = timezone.now()
        email = str(request.data.get('email', '')).strip().casefold() if isinstance(request.data, dict) else ''
        # DRF NUM_PROXIES is 1 on Vercel and 0 for direct/local Django.
        ip = self.get_ident(request)
        if not self.consume_limit('ip', ip, 120, now):
            return False
        return not email or self.consume_limit('account', email, 10, now)

    def wait(self):
        return getattr(self, 'remaining', 60)


class LoginRecoveryThrottle(DatabaseAuthThrottle):
    """Keep the strict account quota; admit very few independently verified retries.

    Never accept a correct password by itself as a bypass: this would permit
    distributed password guessing with rotating IPs.
    """

    def allow_request(self, request, view):
        if request.method != 'POST':
            return True
        now = timezone.now()
        ip = self.get_ident(request)
        if not self.consume_limit('ip', ip, 120, now):
            return False
        email = str(request.data.get('email', '')).strip().casefold() if isinstance(request.data, dict) else ''
        if not email or self.consume_limit('account', email, 10, now):
            return True
        if not login_recovery_enabled():
            return False

        # No account lookup: registered and unregistered email addresses have
        # exactly the same challenge behavior when their quota is exhausted.
        if view is not None:
            view.login_challenge_required = True
        token = request.data.get('turnstile_token') if isinstance(request.data, dict) else None
        if not isinstance(token, str) or not 0 < len(token) <= 2048:
            return False

        # Cheap source-based protection before calling the external Siteverify
        # endpoint. Invalid/unverified tokens never consume the account's
        # precious VERIFIED-recovery quota, preventing easy lockouts.
        if not self.consume_limit('login-challenge-verification-ip', ip, 8, now):
            if view is not None:
                view.login_challenge_required = False
            return False
        if not verify_login_recovery(token, ip):
            return False
        # Cloudflare's concurrent replay detection is eventually consistent:
        # atomically claim the accepted token in PostgreSQL before admission.
        if not claim_login_recovery_token(token):
            return False
        if not self.consume_limit('login-verified-account', email, 2, now):
            if view is not None:
                view.login_challenge_required = False
            return False
        if not self.consume_limit('login-verified-ip', ip, 3, now):
            if view is not None:
                view.login_challenge_required = False
            return False

        if view is not None:
            view.login_challenge_required = False
        return True

    def wait(self):
        return getattr(self, 'remaining', 60)


class DatabaseAccountDeletionThrottle(BaseThrottle):
    """Limit password checks during account deletion across serverless instances.

    Each authenticated account gets five attempts per hour, regardless of IP.
    Counters live in PostgreSQL (not per-instance LocMemCache).
    """

    def allow_request(self, request, view):
        if request.method != 'POST' or not request.user.is_authenticated:
            return True
        now = timezone.now()
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        key = hashlib.sha256(f'account-delete:{request.user.pk}'.encode('utf-8')).hexdigest()
        with transaction.atomic():
            bucket, _ = AuthThrottleBucket.objects.get_or_create(
                key=key, window_start=hour_start, defaults={'attempts': 0},
            )
            AuthThrottleBucket.objects.filter(pk=bucket.pk).update(attempts=F('attempts') + 1)
            bucket.refresh_from_db(fields=['attempts'])
            if bucket.attempts > 5:
                self.remaining = max(1, int((hour_start + timedelta(hours=1) - now).total_seconds()))
                return False
        return True

    def wait(self):
        return getattr(self, 'remaining', 3600)
