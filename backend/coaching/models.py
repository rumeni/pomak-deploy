"""Opt-in coach/client collaboration. A client's data is never re-owned by a coach."""

import secrets
from datetime import timedelta

from django.conf import settings
from django.core.validators import MaxValueValidator
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

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
    # Coach's own reminder of whom the code is for ("invited" clients); never shown to anyone else.
    label = models.CharField(max_length=60, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['coach', 'expires_at'], name='coach_invite_exp_idx')]


class CoachConnection(TimeStampedModel):
    """A collaboration. At most one active coach per client; the client owns sharing preferences.

    Ending it keeps the row as an archive (read-only conversation) instead of deleting it: the
    coach loses access to the client's data, both sides keep what was said.
    """

    class EndedBy(models.TextChoices):
        COACH = 'coach', _('Coach')
        CLIENT = 'client', _('Client')

    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coached_connections')
    client = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coach_connections')
    share_measurements = models.BooleanField(default=False)
    share_nutrition = models.BooleanField(default=False)
    # The pre-workout check-in (sleep, stress, soreness...) and its score: subjective recovery
    # data, shared only with its own consent, never implied by sharing workouts.
    share_readiness = models.BooleanField(default=False)
    # Server-made version of what the coach may see: +1 on every consent change and on the end.
    # Clients order access facts by it, never by when a response happened to arrive.
    access_version = models.PositiveIntegerField(default=1)
    # Coach-side workflow state: a paused client (holiday, injury) raises no inactivity tasks.
    paused_at = models.DateTimeField(null=True, blank=True)
    # When the client became active (connected or resumed); inactivity counts from here at the earliest.
    active_since = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_by = models.CharField(max_length=10, choices=EndedBy.choices, blank=True)
    # Forward cursor of task sync: workouts stored after (tasks_checked_at, tasks_checked_id),
    # in that order, have not been turned into tasks yet.
    tasks_checked_at = models.DateTimeField(null=True, blank=True)
    tasks_checked_id = models.UUIDField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=~models.Q(coach=models.F('client')), name='coach_not_self'),
            models.UniqueConstraint(
                fields=['client'], condition=models.Q(ended_at__isnull=True), name='coach_one_active_per_client',
            ),
        ]
        indexes = [models.Index(fields=['coach', 'ended_at'], name='coach_conn_coach_ended_idx')]


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


class CoachProfile(TimeStampedModel):
    """What a client sees before connecting. Qualifications are self-reported, never verified."""

    class WorkMode(models.TextChoices):
        IN_PERSON = 'in_person', _('In person')
        ONLINE = 'online', _('Online')
        BOTH = 'both', _('In person and online')

    SPECIALTIES = (
        'strength', 'hypertrophy', 'weight_loss', 'general_fitness', 'beginners',
        'mobility', 'injury_recovery', 'sport', 'seniors', 'women',
    )

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coach_profile')
    years_experience = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(60)])
    specialties = models.JSONField(default=list, blank=True)
    qualifications = models.CharField(max_length=500, blank=True)
    bio = models.CharField(max_length=600, blank=True)
    work_mode = models.CharField(max_length=10, choices=WorkMode.choices, blank=True)
    gym_name = models.CharField(max_length=120, blank=True)
    city = models.CharField(max_length=80, blank=True)
    address = models.CharField(max_length=160, blank=True)
    # Set when the coach answered the starting questions.
    completed_at = models.DateTimeField(null=True, blank=True)


class CoachNote(TimeStampedModel):
    """A coach's note about a client: private (only the coach) or shared (the client sees it too)."""

    connection = models.ForeignKey(CoachConnection, on_delete=models.CASCADE, related_name='notes')
    text = models.CharField(max_length=2000)
    visible_to_client = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at', '-id']


class CoachTask(TimeStampedModel):
    """One thing on the coach's overview, raised once per event (unique key) and never repeated."""

    class Kind(models.TextChoices):
        WORKOUT_REVIEW = 'workout_review', _('Finished workout')
        INACTIVE = 'inactive', _('No workouts')
        LOW_READINESS = 'low_readiness', _('Low readiness')
        PERSONAL_RECORD = 'personal_record', _('Personal record')

    class Status(models.TextChoices):
        OPEN = 'open', _('Open')
        DONE = 'done', _('Done')

    connection = models.ForeignKey(CoachConnection, on_delete=models.CASCADE, related_name='tasks')
    kind = models.CharField(max_length=20, choices=Kind.choices)
    # Identifies the event: a workout ID, or the start of a period without workouts.
    key = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    snoozed_until = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    # Closed by the app because it no longer applies (the client trained, was paused), not by the coach.
    auto_resolved = models.BooleanField(default=False)
    # When the event happened (the workout, the last activity), for ordering and display.
    event_at = models.DateTimeField()
    # Facts for the text: workout name, readiness answers, lifts. Only data the coach may see.
    data = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-event_at', '-id']
        constraints = [
            models.UniqueConstraint(fields=['connection', 'kind', 'key'], name='coach_task_once_per_event'),
        ]
        indexes = [models.Index(fields=['connection', 'status'], name='coach_task_status_idx')]
