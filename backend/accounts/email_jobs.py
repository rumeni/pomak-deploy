"""Database-backed delivery queue for account emails.

HTTP endpoints enqueue for both known and unknown addresses and NEVER talk
to SMTP. Invoke dispatch_account_emails from a trusted external scheduler.
"""

import logging
import uuid
from datetime import timedelta

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .email_security import send_reset_email, send_verification_email
from .models import AccountEmailJob, User

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 4
MAX_AGE = timedelta(hours=24)
CLAIM_TTL = timedelta(minutes=5)


def enqueue_account_email(kind, email):
    if kind not in (AccountEmailJob.Kind.RESET, AccountEmailJob.Kind.VERIFY):
        raise ValueError('Unsupported account email job type.')
    return AccountEmailJob.objects.create(kind=kind, email=email.strip().lower())


def enqueue_verification_email_safe(user_pk):
    try:
        user = User.objects.get(pk=user_pk)
        if user.email_verified_at is None:
            enqueue_account_email(AccountEmailJob.Kind.VERIFY, user.email)
    except Exception:
        logger.exception('Could not enqueue account email verification.')


def _claim_jobs(batch_size):
    now = timezone.now()
    expired_claim = now - CLAIM_TTL
    with transaction.atomic():
        jobs = list(
            AccountEmailJob.objects.select_for_update(skip_locked=True)
            .filter(completed_at__isnull=True, available_at__lte=now)
            .filter(Q(claimed_at__isnull=True) | Q(claimed_at__lt=expired_claim))
            .order_by('requested_at')[:batch_size]
        )
        for job in jobs:
            job.claimed_at = now
            job.claim_id = uuid.uuid4()
            job.attempts += 1
            job.save(update_fields=['claimed_at', 'claim_id', 'attempts'])
    return jobs


def dispatch_account_emails(batch_size=50):
    """Deliver from a trusted worker; process each job at most 4 times.

    No token appears in the queue: links are constructed only while sending.
    Never include addresses, tokens or exception arguments in logs.
    """
    succeeded = failed = 0
    for job in _claim_jobs(batch_size):
        try:
            # Old reset requests should not unexpectedly email users after
            # a delayed outage. Verification invites may be safely reissued.
            if timezone.now() - job.requested_at < MAX_AGE:
                user = User.objects.filter(email=job.email, is_active=True).first()
                if user is not None:
                    if job.kind == AccountEmailJob.Kind.RESET:
                        send_reset_email(user)
                    elif job.kind == AccountEmailJob.Kind.VERIFY and user.email_verified_at is None:
                        send_verification_email(user)
            AccountEmailJob.objects.filter(pk=job.pk, claim_id=job.claim_id).delete()
            succeeded += 1
        except Exception:
            failed += 1
            logger.warning('Account email delivery attempt failed; retry queued.')
            if job.attempts >= MAX_ATTEMPTS:
                AccountEmailJob.objects.filter(pk=job.pk, claim_id=job.claim_id).delete()
            else:
                delay = timedelta(minutes=min(30, 2 ** job.attempts))
                AccountEmailJob.objects.filter(pk=job.pk, claim_id=job.claim_id).update(
                    claimed_at=None,
                    claim_id=None,
                    available_at=timezone.now() + delay,
                )
    return {'processed': succeeded, 'retrying_or_failed': failed}
