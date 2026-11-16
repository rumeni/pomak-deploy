"""Reject old JWT sessions after password changes, including legacy access tokens."""

from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User


def token_version_matches(user, token) -> bool:
    value = token.get('session_version', 0)
    return type(value) is int and value == user.session_version


class SessionVersionJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not token_version_matches(user, validated_token):
            raise AuthenticationFailed('Session expired after password change.', code='session_revoked')
        return user


class SessionVersionTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = RefreshToken(attrs['refresh'])
        user = User.objects.filter(pk=refresh.get('user_id'), is_active=True).first()
        if user is None or not token_version_matches(user, refresh):
            raise InvalidToken('Session expired after password change.')
        return super().validate(attrs)
