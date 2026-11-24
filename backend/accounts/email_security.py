"""Email-bound account recovery links; no reset/verification token in logs."""

import logging
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from .models import User

logger = logging.getLogger(__name__)
VERIFICATION_SALT = 'pomak.email.verification.v1'


def password_reset_link(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{settings.ACCOUNT_EMAIL_BASE_URL.rstrip('/')}/lozinka/reset?uid={quote(uid)}&token={quote(token)}"


def email_verification_token(user):
    return signing.dumps({
        'user_id': str(user.pk),
        'email': user.email,
        'session_version': user.session_version,
    }, salt=VERIFICATION_SALT)


def verification_link(user):
    return f"{settings.ACCOUNT_EMAIL_BASE_URL.rstrip('/')}/potvrda-emaila?token={quote(email_verification_token(user))}"


def send_reset_email(user):
    return send_mail(
        subject='POMAK: resetovanje lozinke',
        message=(
            'Ako si zatražio/la resetovanje lozinke, otvori ovaj link (važi 30 minuta):\n\n'
            f'{password_reset_link(user)}\n\n'
            'Ako nisi tražio/la promenu, možeš da ignorišeš poruku.'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )


def send_verification_email(user):
    return send_mail(
        subject='POMAK: potvrdi email adresu',
        message=(
            'Za potvrdu email adrese otvori ovaj link (važi 24 sata):\n\n'
            f'{verification_link(user)}\n\n'
            'Ako nisi napravio/la POMAK nalog, ignoriši poruku.'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )


def send_verification_email_safe(user_pk):
    # A failed email must not roll back a committed registration. The user can
    # resend from the verification screen after fixing the SMTP configuration.
    try:
        user = User.objects.get(pk=user_pk)
        if settings.ACCOUNT_EMAIL_ENABLED and user.email_verified_at is None:
            send_verification_email(user)
    except Exception:
        logger.exception('Could not send POMAK verification email (no token logged).')
