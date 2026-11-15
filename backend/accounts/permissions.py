"""Require verified inbox ownership for accounts created under email gating."""

from rest_framework.permissions import BasePermission


class VerifiedEmailPermission(BasePermission):
    message = 'Confirm your email address to continue.'

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.email_verification_required and user.email_verified_at is None:
            return getattr(view, 'allow_unverified_email', False)
        return True
