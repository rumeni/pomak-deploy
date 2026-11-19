"""Booking rules: who may book what and when, and every change of a booking's state.

Every change locks the collaboration first (as all coaching writes do), then the booking. The
database refuses overlaps by itself; here a refused insert becomes a clear "that time is taken".
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, ValidationError

from coaching.models import CoachConnection
from coaching.views import display_name
from notifications.push import notify

from .availability import booking_settings, is_free_slot
from .models import Booking, SessionType

MAX_COACH_AHEAD = timedelta(days=180)


class SlotTaken(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({'detail': _('That time is no longer free. Choose another one.'), 'code': 'slot_taken'})


class BookingChanged(APIException):
    """The booking is no longer in a state that allows this (confirmed, cancelled meanwhile...)."""

    status_code = status.HTTP_409_CONFLICT

    def __init__(self, detail=None):
        super().__init__({'detail': detail or _('This booking has changed. Reload and try again.'), 'code': 'booking_changed'})


def _lock_connection(connection_id):
    connection = CoachConnection.objects.select_for_update().filter(pk=connection_id).first()
    if connection is None:
        raise NotFound()
    return connection


def _same_request(existing, *, connection, session_type, starts_at, by):
    return (existing.connection_id == connection.pk and existing.session_type_id == session_type.pk
            and existing.starts_at == starts_at and existing.created_by == by)


def create_booking(*, by, connection_id, session_type_id, starts_at, note='', booking_id=None, now=None):
    """Book a session. `by` is the coach (any free time of his) or the client (a free slot).

    A retry with the same ID returns the stored booking (created=False); the same ID for
    anything else is refused.
    """
    now = now or timezone.now()
    with transaction.atomic():
        connection = _lock_connection(connection_id)
        if connection.ended_at is not None:
            raise BookingChanged(_('This collaboration has ended.'))
        session_type = SessionType.objects.filter(pk=session_type_id, coach_id=connection.coach_id).first()
        if session_type is None:
            raise ValidationError({'session_type_id': _('Choose one of the coach\'s session types.')})
        if booking_id:
            existing = Booking.objects.filter(pk=booking_id).first()
            if existing is not None:
                if not _same_request(existing, connection=connection, session_type=session_type, starts_at=starts_at, by=by):
                    raise ValidationError({'id': 'This booking ID is already in use.'})
                return existing, False
        if session_type.archived_at is not None:
            raise ValidationError({'session_type_id': _('This session type is no longer offered.')})
        if starts_at <= now:
            raise ValidationError({'starts_at': _('Choose a time in the future.')})
        if by == Booking.By.CLIENT:
            if not is_free_slot(connection.coach, session_type, starts_at, now=now, client=connection.client):
                raise SlotTaken()
            status_ = Booking.Status.CONFIRMED if booking_settings(connection.coach).auto_confirm else Booking.Status.REQUESTED
        else:
            if starts_at > now + MAX_COACH_AHEAD:
                raise ValidationError({'starts_at': _('Choose a time within the next six months.')})
            status_ = Booking.Status.CONFIRMED
        try:
            with transaction.atomic():
                booking = Booking.objects.create(
                    **({'id': booking_id} if booking_id else {}),
                    coach_id=connection.coach_id, client_id=connection.client_id, connection=connection,
                    session_type=session_type, starts_at=starts_at,
                    ends_at=starts_at + timedelta(minutes=session_type.duration_minutes),
                    status=status_, created_by=by, note=note,
                    decided_at=now if status_ == Booking.Status.CONFIRMED else None,
                )
        except IntegrityError:
            # The coach or the client already has something at that time (checked by the database).
            raise SlotTaken() from None
        _announce_new(booking, connection)
        return booking, True


def _booking_for_change(booking_id, *, user):
    """The booking (locked after its collaboration), if the user is its coach or client."""
    row = Booking.objects.filter(pk=booking_id).values('connection_id', 'coach_id', 'client_id').first()
    if row is None or user.pk not in (row['coach_id'], row['client_id']):
        raise NotFound()
    connection = _lock_connection(row['connection_id'])
    return Booking.objects.select_for_update().select_related('session_type').get(pk=booking_id), connection


def confirm(booking_id, *, user, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        booking, connection = _booking_for_change(booking_id, user=user)
        if user.pk != booking.coach_id:
            raise NotFound()
        if booking.status == Booking.Status.CONFIRMED:
            return booking
        if booking.status != Booking.Status.REQUESTED or booking.starts_at <= now:
            raise BookingChanged()
        booking.status = Booking.Status.CONFIRMED
        booking.decided_at = now
        booking.save(update_fields=['status', 'decided_at', 'updated_at'])
        notify(connection.client, title='POMAK', body=_('Your session is confirmed.'), url='/trener', tag=f'booking-{booking.pk}')
        return booking


def decline(booking_id, *, user, reason='', now=None):
    now = now or timezone.now()
    with transaction.atomic():
        booking, connection = _booking_for_change(booking_id, user=user)
        if user.pk != booking.coach_id:
            raise NotFound()
        if booking.status == Booking.Status.DECLINED:
            return booking
        if booking.status != Booking.Status.REQUESTED:
            raise BookingChanged()
        booking.status = Booking.Status.DECLINED
        booking.decided_at = now
        booking.cancel_reason = reason
        booking.save(update_fields=['status', 'decided_at', 'cancel_reason', 'updated_at'])
        notify(connection.client, title='POMAK', body=_('Your session request was declined.'), url='/trener', tag=f'booking-{booking.pk}')
        return booking


def can_client_cancel(booking, now) -> bool:
    if booking.status == Booking.Status.REQUESTED:
        return booking.starts_at > now
    if booking.status != Booking.Status.CONFIRMED:
        return False
    return now <= booking.starts_at - timedelta(hours=booking_settings(booking.coach).cancel_hours)


def cancel(booking_id, *, user, reason='', now=None):
    """The client until the coach's deadline (or any time while only requested); the coach until
    the session is over."""
    now = now or timezone.now()
    with transaction.atomic():
        booking, connection = _booking_for_change(booking_id, user=user)
        if booking.status == Booking.Status.CANCELLED:
            return booking
        by_coach = user.pk == booking.coach_id
        if booking.status not in Booking.HOLDS_TIME:
            raise BookingChanged()
        if by_coach:
            if booking.ends_at <= now:
                raise BookingChanged(_('This session is already over.'))
        elif not can_client_cancel(booking, now):
            raise BookingChanged(_('It is too late to cancel online. Message your coach.'))
        booking.status = Booking.Status.CANCELLED
        booking.cancelled_at = now
        booking.cancelled_by = Booking.By.COACH if by_coach else Booking.By.CLIENT
        booking.cancel_reason = reason
        booking.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_at'])
        if by_coach:
            notify(connection.client, title='POMAK', body=_('Your coach cancelled a session.'), url='/trener', tag=f'booking-{booking.pk}')
        else:
            notify(connection.coach, title=display_name(connection.client), body=_('Cancelled a session.'),
                   url='/trener/kalendar', tag=f'booking-{booking.pk}')
        return booking


def cancel_future_of(connection, now=None):
    """The collaboration ended: its future sessions are cancelled (call with it locked)."""
    now = now or timezone.now()
    Booking.objects.filter(connection=connection, status__in=Booking.HOLDS_TIME, starts_at__gt=now).update(
        status=Booking.Status.CANCELLED, cancelled_at=now, cancelled_by=Booking.By.SYSTEM, updated_at=now,
    )


def _announce_new(booking, connection):
    if booking.created_by == Booking.By.COACH:
        notify(connection.client, title='POMAK', body=_('Your coach booked a session for you.'), url='/trener', tag=f'booking-{booking.pk}')
        return
    body = _('Booked a session.') if booking.status == Booking.Status.CONFIRMED else _('Requested a session.')
    notify(connection.coach, title=display_name(connection.client), body=body, url='/trener/kalendar', tag=f'booking-{booking.pk}')
