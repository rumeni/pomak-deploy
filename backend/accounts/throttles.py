"""PostgreSQL-backed auth throttling shared by all Vercel Python instances."""

import hashlib
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.throttling import BaseThrottle

from .models import AuthThrottleBucket
from .turnstile import claim_login_recovery_token, login_recovery_enabled, verify_login_recovery

# One source IP cannot create more than ~88k minute/account buckets per day.
# Cron clears up to 150k old rows per daily run. Distributed abuse still needs WAF.
AUTH_IP_LIMIT_PER_MINUTE = 60


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
        if not self.consume_limit('ip', ip, AUTH_IP_LIMIT_PER_MINUTE, now):
            return False
        return not email or self.consume_limit('account', email, 10, now)

    def wait(self):
        return getattr(self, 'remaining', 60)


# Preserve free-queue capacity; conservative MVP quotas, independent of account existence.
RESET_PER_IP_PER_DAY = 20
RESET_PER_EMAIL_PER_DAY = 3
RESET_GLOBAL_PER_DAY = 150


class PasswordResetThrottle(DatabaseAuthThrottle):
    """Atomic daily QStash budget shared by every API instance.

    All counters are based on supplied email/IP, never on whether an account
    exists. These quotas only cap consumption; WAF is still required against
    distributed denial of service.
    """

    def _daily_limit(self, kind, identity, limit, now):
        # Daily buckets are keyed by the NEXT midnight (their expiry), not the
        # current midnight. The shared maintenance job prunes rows older than
        # two hours by window_start; storing the start of today would make its
        # 04:00 UTC run erase today's quotas. Expiry-based timestamps preserve
        # daily budgets until tomorrow without extending minute-bucket storage.
        day_end = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        key = hashlib.sha256(f'reset-day:{kind}:{identity}'.encode('utf-8')).hexdigest()
        with transaction.atomic():
            bucket, _ = AuthThrottleBucket.objects.get_or_create(
                key=key, window_start=day_end, defaults={'attempts': 0},
            )
            AuthThrottleBucket.objects.filter(pk=bucket.pk).update(attempts=F('attempts') + 1)
            bucket.refresh_from_db(fields=['attempts'])
            if bucket.attempts > limit:
                self.remaining = max(1, int((day_end - now).total_seconds()))
                return False
        return True

    def allow_request(self, request, view):
        if not super().allow_request(request, view):
            return False
        if request.method != 'POST':
            return True
        now = timezone.now()
        ip = self.get_ident(request)
        email = str(request.data.get('email', '')).strip().casefold() if isinstance(request.data, dict) else ''
        if not self._daily_limit('ip', ip, RESET_PER_IP_PER_DAY, now):
            return False
        if email and not self._daily_limit('email', email, RESET_PER_EMAIL_PER_DAY, now):
            return False
        return self._daily_limit('global', 'all', RESET_GLOBAL_PER_DAY, now)


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
        if not self.consume_limit('ip', ip, AUTH_IP_LIMIT_PER_MINUTE, now):
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
    """Independent per-account 5/hour quotas for each sensitive account action.

    Password change, account deletion, and email resend must not lock one
    another out. PostgreSQL counters work across all serverless instances.
    """

    def allow_request(self, request, view):
        if request.method != 'POST' or not request.user.is_authenticated:
            return True
        now = timezone.now()
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        scope = getattr(view, 'sensitive_action_scope', 'account-delete')
        key = hashlib.sha256(f'account-sensitive:{scope}:{request.user.pk}'.encode('utf-8')).hexdigest()
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
