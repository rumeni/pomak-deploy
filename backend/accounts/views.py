from django.http import HttpResponse
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .export import build_zip
from .serializers import LoginSerializer, MeSerializer, RegisterSerializer


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_scope = 'auth'


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_scope = 'auth'


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

    def post(self, request):
        password = request.data.get('password', '')
        if not request.user.check_password(password):
            raise ValidationError({'password': _('Wrong password.')})
        request.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
