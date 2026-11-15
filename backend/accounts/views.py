from django.http import HttpResponse
from django.utils.encoding import force_str
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import generics, status
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .export import build_zip
from .serializers import LoginSerializer, MeSerializer, RegisterSerializer
from .token_transport import clear_refresh_cookie, incoming_refresh, output_tokens, web_request
from .throttles import DatabaseAccountDeletionThrottle, DatabaseAuthThrottle, LoginRecoveryThrottle


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_scope = 'auth'
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_scope = 'auth'
    throttle_classes = [LoginRecoveryThrottle, AnonRateThrottle, ScopedRateThrottle]

    def post(self, request, *args, **kwargs):
        return output_tokens(request, super().post(request, *args, **kwargs))

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
    throttle_scope = 'auth'
    throttle_classes = [DatabaseAuthThrottle, AnonRateThrottle, ScopedRateThrottle]

    def post(self, request, *args, **kwargs):
        if not request.data.get('refresh') and request.COOKIES.get('pomak.refresh'):
            request._full_data = {**request.data, 'refresh': incoming_refresh(request)}
        return output_tokens(request, super().post(request, *args, **kwargs))


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = incoming_refresh(request)
        if not isinstance(token, str) or not token:
            raise ValidationError({'refresh': _('Refresh token is required.')})
        try:
            refresh = RefreshToken(token)
            if str(refresh.get('user_id')) != str(request.user.pk):
                raise ValidationError({'refresh': _('Invalid refresh token.')})
            refresh.blacklist()
        except TokenError:
            raise ValidationError({'refresh': _('Invalid refresh token.')}) from None
        response = Response(status=status.HTTP_204_NO_CONTENT)
        return clear_refresh_cookie(response) if web_request(request) else response


class MeView(generics.RetrieveUpdateAPIView):
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
    throttle_classes = [DatabaseAccountDeletionThrottle, UserRateThrottle]

    def post(self, request):
        password = request.data.get('password', '')
        if not request.user.check_password(password):
            raise ValidationError({'password': _('Wrong password.')})
        request.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
