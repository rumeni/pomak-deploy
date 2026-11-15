"""Opt-in coach/client collaboration. A client's data is never re-owned by a coach."""

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import TimeStampedModel


def invite_code():
    # 64 bits of unpredictable entropy; no user identifiers in the token.
    return secrets.token_hex(8).upper()


def invite_expires_at():
    return timezone.now() + timedelta(days=7)


class CoachInvitation(TimeStampedModel):
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coach_invites')
    code = models.CharField(max_length=16, unique=True, default=invite_code)
    expires_at = models.DateTimeField(default=invite_expires_at)
    redeemed_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['coach', 'expires_at'], name='coach_invite_exp_idx')]


class CoachConnection(TimeStampedModel):
    """Exactly one active coach per client. The client owns sharing preferences."""

    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coached_connections')
    client = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coach_connection')
    share_measurements = models.BooleanField(default=False)
    share_nutrition = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=~models.Q(coach=models.F('client')), name='coach_not_self'),
        ]


class CoachMessage(TimeStampedModel):
    connection = models.ForeignKey(CoachConnection, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coaching_messages')
    text = models.CharField(max_length=800)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [models.Index(fields=['connection', '-created_at'], name='coach_msg_recent_idx')]


class CoachAssignment(TimeStampedModel):
    """An attribution record; the copied routine belongs to the client independently."""

    connection = models.ForeignKey(CoachConnection, on_delete=models.CASCADE, related_name='assignments')
    routine = models.OneToOneField('training.Routine', on_delete=models.CASCADE, related_name='coaching_assignment')

    class Meta:
        ordering = ['-created_at']
