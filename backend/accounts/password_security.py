"""Atomic password changes revoke all existing JWT sessions."""

from django.db import transaction
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken


@transaction.atomic
def replace_password_and_revoke_sessions(user, new_password):
    # Caller holds a select_for_update() lock on the user to serialize changes.
    user.set_password(new_password)
    user.session_version += 1
    user.save(update_fields=['password', 'session_version'])
    # Blacklist outstanding refresh tokens as defense in depth. Older access
    # tokens are rejected immediately by SessionVersionJWTAuthentication.
    tokens = OutstandingToken.objects.filter(user=user).exclude(blacklistedtoken__isnull=False)
    for token in tokens.iterator():
        BlacklistedToken.objects.get_or_create(token=token)
