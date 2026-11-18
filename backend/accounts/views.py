from django.db import transaction
from django.http import HttpResponse
from django.utils.encoding import force_str
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import generics, status
from rest_framework.exceptions import NotAuthenticated, Throttled, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.views import require_object_body

from .authentication import SessionVersionTokenRefreshSerializer
from .export import build_zip
from .serializers import LoginSerializer, MeSerializer, RegisterSerializer
from .token_transport import clear_refresh_cookie, incoming_refresh, output_tokens, web_request
from .throttles import DatabaseAccountDeletionThrottle, DatabaseAuthThrottle, LoginRecoveryThrottle


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_scope = 'auth'
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]

    def create(self, request, *args, **kwargs):
        # Native/legacy registration retains refresh in the JSON response.
        if not web_request(request):
            return output_tokens(request, super().create(request, *args, **kwargs))

        # A previous offline logout might have failed to reach the backend.
        # Do not allow a new web registration to keep the old account's
        # refresh token alive while issuing a fresh HttpOnly cookie.
        # Roll back account creation if token revocation fails unexpectedly.
        with transaction.atomic():
            response = super().create(request, *args, **kwargs)
            if response.status_code < 400:
                previous = request.COOKIES.get('pomak.refresh')
                if previous:
                    try:
                        RefreshToken(previous).blacklist()
                    except TokenError:
                        # Expired, malformed or previously revoked cookies are
                        # harmless; DB failures must propagate and roll back.
                        pass
            return output_tokens(request, response)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_scope = 'auth'
    throttle_classes = [LoginRecoveryThrottle, AnonRateThrottle, ScopedRateThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if web_request(request) and response.status_code < 400:
            # A previous offline logout may not have reached the server.
            # When a *new* password-verified web login succeeds, revoke the
            # previous cookie before minting the replacement on this response.
            # A DB failure must abort the login rather than leave two live
            # refresh tokens. An expired/revoked old cookie is harmless.
            previous = request.COOKIES.get('pomak.refresh')
            if previous:
                try:
                    RefreshToken(previous).blacklist()
                except TokenError:
                    pass
        return output_tokens(request, response)

    def throttled(self, request, wait):
        if getattr(self, 'login_challenge_required', False):
            # DRF's Throttled constructor appends the retry duration to a
            # STRING detail. Give it a string first, then add our stable
            # machine-readable code to the structured response.
            exc = Throttled(
                wait=wait,
                detail=force_str(_('Too many sign-in attempts. Complete verification to try again.')),
            )
            exc.detail = {'detail': exc.detail, 'code': 'login_verification_required'}
            raise exc
        return super().throttled(request, wait)


class RefreshView(TokenRefreshView):
    serializer_class = SessionVersionTokenRefreshSerializer
    throttle_scope = 'auth'
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]

    def post(self, request, *args, **kwargs):
        require_object_body(request)
        if web_request(request) and not request.data.get('refresh') and request.COOKIES.get('pomak.refresh'):
            request._full_data = {**request.data, 'refresh': incoming_refresh(request)}
        return output_tokens(request, super().post(request, *args, **kwargs))


def forget_push_device(user_id, token):
    """Signing out on a device turns its notifications off for that account."""
    from notifications.models import PushDevice

    if user_id and isinstance(token, str) and 0 < len(token) <= 2000:
        PushDevice.objects.filter(user_id=user_id, token=token).delete()


class LogoutView(APIView):
    # Cookie-only web logout works even after a reload cleared the access token.
    # Legacy clients without the explicit web header still require Bearer auth.
    permission_classes = [AllowAny]

    def post(self, request):
        require_object_body(request)
        if not web_request(request) and not request.user.is_authenticated:
            raise NotAuthenticated()
        token = incoming_refresh(request)
        if not isinstance(token, str) or not token:
            # Offline web logout can be retried after the cookie has expired.
            if web_request(request):
                return clear_refresh_cookie(Response(status=status.HTTP_204_NO_CONTENT))
            raise ValidationError({'refresh': _('Refresh token is required.')})
        try:
            refresh = RefreshToken(token)
            if request.user.is_authenticated and str(refresh.get('user_id')) != str(request.user.pk):
                raise ValidationError({'refresh': _('Invalid refresh token.')})
            refresh.blacklist()
            forget_push_device(refresh.get('user_id'), request.data.get('push_token'))
        except TokenError:
            # Missing/revoked cookie is already logged out; always clear it.
            if web_request(request) and not request.data.get('refresh'):
                return clear_refresh_cookie(Response(status=status.HTTP_204_NO_CONTENT))
            raise ValidationError({'refresh': _('Invalid refresh token.')}) from None
        response = Response(status=status.HTTP_204_NO_CONTENT)
        return clear_refresh_cookie(response) if web_request(request) else response


class MeView(generics.RetrieveUpdateAPIView):
    allow_unverified_email = True
    serializer_class = MeSerializer
    http_method_names = ['get', 'patch']

    def get_object(self):
        return self.request.user


class CompleteOnboardingView(APIView):
    def post(self, request):
        profile = request.user.profile
        if profile.onboarding_completed_at is None:
            profile.onboarding_completed_at = timezone.now()
            profile.save(update_fields=['onboarding_completed_at'])
        return Response(MeSerializer(request.user).data, status=status.HTTP_200_OK)


class ExportView(APIView):
    """GET: svi podaci korisnika kao ZIP (pomak.json + CSV tabele)."""

    def get(self, request):
        response = HttpResponse(build_zip(request.user), content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="pomak-izvoz-{timezone.localdate()}.zip"'
        return response


class DeleteAccountView(APIView):
    """POST {password}: trajno briše nalog i sve lične podatke (treninge, dnevnik, merenja, recepte...)."""

    sensitive_action_scope = 'account-delete'
    allow_unverified_email = True  # Allow deletion before email confirmation.
    throttle_classes = [DatabaseAccountDeletionThrottle, UserRateThrottle]

    def post(self, request):
        require_object_body(request)
        password = request.data.get('password', '')
        if not request.user.check_password(password):
            raise ValidationError({'password': _('Wrong password.')})
        request.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
