"""Sessions with a coach: what can be booked, when the coach works, and the bookings.

Overlaps are impossible in the database itself: an exclusion constraint per coach and per client
over the time range of every booking that still holds its time (requested or confirmed). Two
requests for the same time can never both succeed, whatever the application does.
"""

from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeBoundary, RangeOperators
from django.db import models
from django.db.models import F, Func, Q
from django.utils.translation import gettext_lazy as _

from core.models import TimeStampedModel


class TsTzRange(Func):
    function = 'TSTZRANGE'
    output_field = DateTimeRangeField()


class BookingSettings(models.Model):
    """How clients may book this coach (sensible defaults until the coach changes them)."""

    coach = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True, related_name='booking_settings')
    # Booked at once, or a request the coach confirms.
    auto_confirm = models.BooleanField(default=True)
    # A client may cancel until this many hours before; later only the coach can.
    cancel_hours = models.PositiveSmallIntegerField(default=12)
    # At least this many hours ahead, at most this many days ahead.
    min_notice_hours = models.PositiveSmallIntegerField(default=2)
    horizon_days = models.PositiveSmallIntegerField(default=28)
    # Slots start every this many minutes within working hours.
    slot_step_minutes = models.PositiveSmallIntegerField(default=30)
    updated_at = models.DateTimeField(auto_now=True)


class SessionType(TimeStampedModel):
    """A kind of session the coach offers: personal training 60 min, online check-in 30 min..."""

    class Mode(models.TextChoices):
        IN_PERSON = 'in_person', _('In person')
        ONLINE = 'online', _('Online')

    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='session_types')
    name = models.CharField(max_length=80)
    duration_minutes = models.PositiveSmallIntegerField()
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.IN_PERSON)
    # Archived types stay on past bookings but cannot be booked any more.
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name', 'id']
        constraints = [
            models.CheckConstraint(condition=Q(duration_minutes__gte=15, duration_minutes__lte=240), name='session_type_duration_range'),
        ]


class WorkingHours(models.Model):
    """A weekly window in which clients can book (Monday = 0, local time of the app)."""

    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='working_hours')
    weekday = models.PositiveSmallIntegerField()
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        ordering = ['weekday', 'start_time']
        constraints = [
            models.CheckConstraint(condition=Q(weekday__lte=6), name='working_hours_weekday'),
            models.CheckConstraint(condition=Q(end_time__gt=F('start_time')), name='working_hours_order'),
        ]


class ScheduleException(TimeStampedModel):
    """A change to the weekly hours: closed (holiday, sick day) or extra open time."""

    class Kind(models.TextChoices):
        CLOSED = 'closed', _('Closed')
        OPEN = 'open', _('Extra hours')

    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='schedule_exceptions')
    kind = models.CharField(max_length=6, choices=Kind.choices)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    note = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ['starts_at']
        constraints = [models.CheckConstraint(condition=Q(ends_at__gt=F('starts_at')), name='schedule_exception_order')]


class Booking(TimeStampedModel):
    """A session at a time. The ID may be made by the app, so a retried request never books twice."""

    class Status(models.TextChoices):
        REQUESTED = 'requested', _('Requested')
        CONFIRMED = 'confirmed', _('Confirmed')
        DECLINED = 'declined', _('Declined')
        CANCELLED = 'cancelled', _('Cancelled')

    class By(models.TextChoices):
        COACH = 'coach', _('Coach')
        CLIENT = 'client', _('Client')
        SYSTEM = 'system', _('System')

    HOLDS_TIME = (Status.REQUESTED, Status.CONFIRMED)

    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coach_bookings')
    client = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='client_bookings')
    connection = models.ForeignKey('coaching.CoachConnection', on_delete=models.CASCADE, related_name='bookings')
    session_type = models.ForeignKey(SessionType, on_delete=models.PROTECT, related_name='bookings')
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=Status.choices)
    created_by = models.CharField(max_length=6, choices=By.choices)
    note = models.CharField(max_length=300, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.CharField(max_length=6, choices=By.choices, blank=True)
    cancel_reason = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['starts_at', 'id']
        indexes = [
            models.Index(fields=['coach', 'starts_at'], name='booking_coach_start_idx'),
            models.Index(fields=['client', 'starts_at'], name='booking_client_start_idx'),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(ends_at__gt=F('starts_at')), name='booking_order'),
            ExclusionConstraint(
                name='booking_coach_no_overlap',
                expressions=[(TsTzRange('starts_at', 'ends_at', RangeBoundary()), RangeOperators.OVERLAPS), ('coach', RangeOperators.EQUAL)],
                condition=Q(status__in=['requested', 'confirmed']),
            ),
            ExclusionConstraint(
                name='booking_client_no_overlap',
                expressions=[(TsTzRange('starts_at', 'ends_at', RangeBoundary()), RangeOperators.OVERLAPS), ('client', RangeOperators.EQUAL)],
                condition=Q(status__in=['requested', 'confirmed']),
            ),
        ]
