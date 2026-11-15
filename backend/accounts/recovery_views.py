"""Password recovery and email ownership confirmation endpoints."""

import logging

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle
from rest_framework.views import APIView

from .email_security import VERIFICATION_SALT, send_reset_email, send_verification_email_safe
from .models import User
from .password_security import replace_password_and_revoke_sessions
from .throttles import DatabaseAccountDeletionThrottle, DatabaseAuthThrottle
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
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]
    throttle_scope = 'auth'

    def post(self, request):
        require_email_configured()
        from rest_framework.fields import EmailField
        email = EmailField().run_validation(request.data.get('email', '')).strip().lower()
        user = User.objects.filter(email=email, is_active=True).first()
        if user:
            try:
                send_reset_email(user)
            except Exception:
                logger.exception('POMAK password reset email delivery failed (token omitted).')
        # Identical response, including SMTP failures, for known/unknown email.
        return Response(GENERIC_SENT, status=status.HTTP_202_ACCEPTED)


class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]
    throttle_scope = 'auth'

    def post(self, request):
        require_email_configured()
        uid = request.data.get('uid', '')
        token = request.data.get('token', '')
        if not isinstance(uid, str) or not isinstance(token, str) or len(uid) > 128 or len(token) > 256:
            raise ValidationError(GENERIC_INVALID)
        try:
            user_pk = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_pk, is_active=True)
        except (ValueError, TypeError, OverflowError, UnicodeDecodeError, User.DoesNotExist):
            raise ValidationError(GENERIC_INVALID) from None
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=user.pk)
            if not default_token_generator.check_token(user, token):
                raise ValidationError(GENERIC_INVALID)
            new_password = request.data.get('new_password', '')
            password_validated(user, new_password)
            replace_password_and_revoke_sessions(user, new_password)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        return clear_refresh_cookie(response) if web_request(request) else response


class PasswordChangeView(APIView):
    throttle_classes = [DatabaseAccountDeletionThrottle]
    def post(self, request):
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
        token = request.data.get('token', '')
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
    # Explicit authentication lets an unverified user request a new email.
    throttle_classes = [DatabaseAccountDeletionThrottle]

    def post(self, request):
        require_email_configured()
        if request.user.email_verified_at is None:
            send_verification_email_safe(request.user.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)
