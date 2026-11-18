"""Password recovery and email ownership confirmation endpoints."""

import base64
import hashlib
import hmac
import json
import logging
from urllib.request import Request, urlopen

import jwt

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle
from rest_framework.views import APIView

from core.views import require_object_body

from .email_security import VERIFICATION_SALT, send_reset_email, send_verification_email_safe
from .models import User
from .password_security import replace_password_and_revoke_sessions
from .throttles import DatabaseAccountDeletionThrottle, DatabaseAuthThrottle, PasswordResetThrottle
from .token_transport import clear_refresh_cookie, web_request

logger = logging.getLogger(__name__)
GENERIC_SENT = {'detail': 'If the account exists, check your inbox.'}
GENERIC_INVALID = {'token': 'Invalid or expired link.'}


class EmailNotConfigured(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = 'Account email delivery is not yet configured.'
    default_code = 'email_unavailable'


def require_email_configured():
    if not settings.ACCOUNT_EMAIL_ENABLED:
        raise EmailNotConfigured()


def _queue_configured():
    return all((
        settings.ACCOUNT_EMAIL_WORKER_URL,
        settings.QSTASH_TOKEN,
        settings.QSTASH_CURRENT_SIGNING_KEY,
        settings.QSTASH_NEXT_SIGNING_KEY,
    ))


def _publish_reset_request(email):
    """Publish for EVERY syntactically valid email, without an account lookup.

    SMTP and account existence checks happen in the signed queue worker only.
    The request body is redacted in QStash logs and duplicates deduped for 10m.
    """
    body = json.dumps({'email': email}, separators=(',', ':')).encode('utf-8')
    req = Request(
        'https://qstash.upstash.io/v2/publish/' + settings.ACCOUNT_EMAIL_WORKER_URL,
        data=body,
        headers={
            'Authorization': 'Bearer ' + settings.QSTASH_TOKEN,
            'Content-Type': 'application/json',
            'Upstash-Content-Based-Deduplication': 'true',
            'Upstash-Redact-Fields': 'body',
            'Upstash-Retries': '3',
        },
        method='POST',
    )
    with urlopen(req, timeout=4) as delivery:
        if not 200 <= delivery.status < 300:
            raise RuntimeError('Email queue publish rejected')


def _valid_qstash_signature(signature, raw_body):
    return valid_qstash_signature(signature, raw_body) if _queue_configured() else False


def valid_qstash_signature(signature, raw_body, subject=None):
    """A QStash-signed callback for `subject` (the worker URL; the e-mail worker by default)."""
    subject = subject or settings.ACCOUNT_EMAIL_WORKER_URL
    if (not signature or len(signature) > 4096 or not subject or not settings.QSTASH_TOKEN
            or not settings.QSTASH_CURRENT_SIGNING_KEY or not settings.QSTASH_NEXT_SIGNING_KEY):
        return False
    for key in (settings.QSTASH_CURRENT_SIGNING_KEY, settings.QSTASH_NEXT_SIGNING_KEY):
        try:
            payload = jwt.decode(
                signature, key, algorithms=['HS256'], issuer='Upstash',
                options={'require': ['iss', 'sub', 'nbf', 'exp', 'body']},
            )
            expected = base64.urlsafe_b64encode(hashlib.sha256(raw_body).digest()).decode('ascii').rstrip('=')
            actual = payload.get('body', '')
            if (payload.get('sub') == subject
                    and isinstance(actual, str) and hmac.compare_digest(expected, actual.rstrip('='))):
                return True
        except jwt.InvalidTokenError:
            continue
    return False


@csrf_exempt
@require_POST
def password_reset_email_worker(request):
    """Publicly reachable only to QStash-signed messages, not browser clients."""
    if not settings.ACCOUNT_EMAIL_ENABLED:
        return HttpResponse(status=503)
    if not _valid_qstash_signature(request.headers.get('Upstash-Signature', ''), request.body):
        return HttpResponse(status=403)
    try:
        data = json.loads(request.body)
        email = data.get('email') if isinstance(data, dict) else None
        if not isinstance(email, str) or not email or len(email) > 254:
            return HttpResponse(status=400)
    except (UnicodeDecodeError, ValueError, TypeError):
        return HttpResponse(status=400)
    user = User.objects.filter(email=email, is_active=True).first()
    if user:
        try:
            send_reset_email(user)
        except Exception:
            # A non-2xx response lets QStash retry. Never log addresses or tokens.
            logger.error('POMAK reset delivery failed; queue will retry.')
            return HttpResponse(status=503)
    return HttpResponse(status=204)


def password_validated(user, new_password):
    if not isinstance(new_password, str) or len(new_password) > 4096:
        raise ValidationError({'new_password': 'Enter a valid password.'})
    try:
        validate_password(new_password, user)
    except DjangoValidationError as exc:
        raise ValidationError({'new_password': list(exc.messages)}) from None
    if user.check_password(new_password):
        raise ValidationError({'new_password': 'Choose a different password.'})


class PasswordResetRequestView(APIView):
    # Do not authenticate from an old access token on a forgotten-password page.
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetThrottle, AnonRateThrottle, ScopedRateThrottle]
    throttle_scope = 'auth'

    def post(self, request):
        require_email_configured()
        data = require_object_body(request)
        from rest_framework.fields import EmailField
        email = EmailField().run_validation(data.get('email', '')).strip().lower()
        if not _queue_configured():
            raise EmailNotConfigured()
        try:
            _publish_reset_request(email)
        except Exception:
            # Fail closed for ALL addresses, without exposing the address or token.
            logger.error('POMAK password reset queue unavailable.')
            raise EmailNotConfigured() from None
        return Response(GENERIC_SENT, status=status.HTTP_202_ACCEPTED)


class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]
    throttle_scope = 'auth'

    def post(self, request):
        require_email_configured()
        data = require_object_body(request)
        uid = data.get('uid', '')
        token = data.get('token', '')
        if not isinstance(uid, str) or not isinstance(token, str) or len(uid) > 128 or len(token) > 256:
            raise ValidationError(GENERIC_INVALID)
        try:
            user_pk = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_pk, is_active=True)
        except (ValueError, TypeError, OverflowError, UnicodeDecodeError, DjangoValidationError, User.DoesNotExist):
            raise ValidationError(GENERIC_INVALID) from None
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=user.pk)
            if not default_token_generator.check_token(user, token):
                raise ValidationError(GENERIC_INVALID)
            new_password = data.get('new_password', '')
            password_validated(user, new_password)
            replace_password_and_revoke_sessions(user, new_password)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        return clear_refresh_cookie(response) if web_request(request) else response


class PasswordChangeView(APIView):
    sensitive_action_scope = 'password-change'
    throttle_classes = [DatabaseAccountDeletionThrottle]

    def post(self, request):
        require_object_body(request)
        old_password = request.data.get('old_password', '')
        new_password = request.data.get('new_password', '')
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=request.user.pk)
            if not isinstance(old_password, str) or not user.check_password(old_password):
                raise ValidationError({'old_password': 'Incorrect password.'})
            password_validated(user, new_password)
            replace_password_and_revoke_sessions(user, new_password)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        return clear_refresh_cookie(response) if web_request(request) else response


class EmailVerificationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]
    throttle_scope = 'auth'

    def post(self, request):
        require_email_configured()
        data = require_object_body(request)
        token = data.get('token', '')
        if not isinstance(token, str) or not 0 < len(token) <= 2048:
            raise ValidationError(GENERIC_INVALID)
        try:
            data = signing.loads(
                token, salt=VERIFICATION_SALT, max_age=settings.EMAIL_VERIFICATION_TIMEOUT,
            )
            user_id = data['user_id']
            email = data['email']
            version = data['session_version']
        except (signing.BadSignature, TypeError, KeyError, ValueError):
            raise ValidationError(GENERIC_INVALID) from None
        try:
            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=user_id, is_active=True)
                if user.email != email or user.session_version != version or user.email_verified_at:
                    raise ValidationError(GENERIC_INVALID)
                user.email_verified_at = timezone.now()
                user.save(update_fields=['email_verified_at'])
        except (ValueError, TypeError, User.DoesNotExist):
            raise ValidationError(GENERIC_INVALID) from None
        return Response({'verified': True}, status=status.HTTP_200_OK)


class EmailVerificationResendView(APIView):
    permission_classes = [IsAuthenticated]
    sensitive_action_scope = 'email-verification-resend'
    # Explicit authentication lets an unverified user request a new email.
    throttle_classes = [DatabaseAccountDeletionThrottle]

    def post(self, request):
        require_email_configured()
        require_object_body(request)
        if request.user.email_verified_at is None:
            send_verification_email_safe(request.user.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)
