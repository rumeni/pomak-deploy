"""Booking rules: who may book what and when, every change of a booking, packages and reminders.

Lock order, always: the collaboration row, then the coach's schedule lock (`lock_schedule`), then
bookings. Configuration changes take only the schedule lock, so a booking's availability check
and its insert can never interleave with closing time, archiving a type or new working hours.
The current time is read after the locks are held. The database refuses overlaps by itself; a
refused insert becomes a clear "that time is taken".
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.text import format_lazy
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, ValidationError

from coaching.errors import CollaborationChanged
from coaching.models import CoachConnection
from coaching.views import display_name
from notifications.push import notify

from .availability import LOCAL, UTC, booking_settings, is_free_slot, lock_schedule
from .models import Booking, BookingReminder, SessionPackage, SessionType

MAX_COACH_AHEAD = timedelta(days=180)
REMINDER_HOURS = (24, 1)
# A reminder later than this after its time is not sent any more (the moment has passed).
REMINDER_GRACE = timedelta(minutes=30)


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


def create_booking(*, user, by, connection_id, session_type_id, starts_at, note='', booking_id=None):
    """Book a session in exactly this collaboration (the one the form was made for).

    The coach books any time; the client books a free slot. A retry with the same ID and the same
    request returns the stored booking (created=False), whatever its state now; the same ID with
    anything different is refused.
    """
    starts_at = starts_at.astimezone(UTC).replace(second=0, microsecond=0)
    with transaction.atomic():
        connection = _lock_connection(connection_id)
        owner = connection.coach_id if by == Booking.By.COACH else connection.client_id
        if owner != user.pk:
            raise CollaborationChanged()
        if booking_id:
            existing = Booking.objects.filter(pk=booking_id).first()
            if existing is not None:
                same = (existing.connection_id == connection.pk and existing.session_type_id == session_type_id
                        and existing.starts_at == starts_at and existing.created_by == by and existing.note == note)
                if not same:
                    raise ValidationError({'id': 'This booking ID is already in use for another request.'})
                return existing, False
        if connection.ended_at is not None:
            raise CollaborationChanged()
        lock_schedule(connection.coach_id)
        now = timezone.now()  # after waiting for the locks
        session_type = SessionType.objects.filter(pk=session_type_id, coach_id=connection.coach_id).first()
        if session_type is None:
            raise ValidationError({'session_type_id': _("Choose one of the coach's session types.")})
        if session_type.archived_at is not None:
            raise ValidationError({'session_type_id': _('This session type is no longer offered.')})
        if starts_at <= now:
            raise ValidationError({'starts_at': _('Choose a time in the future.')})
        if by == Booking.By.CLIENT:
            if not is_free_slot(connection.coach, session_type.duration_minutes, starts_at, now=now, client=connection.client):
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
                    session_type=session_type, type_name=session_type.name, type_mode=session_type.mode,
                    starts_at=starts_at, ends_at=starts_at + timedelta(minutes=session_type.duration_minutes),
                    status=status_, created_by=by, note=note,
                    decided_at=now if status_ == Booking.Status.CONFIRMED else None,
                )
        except IntegrityError:
            # The coach or the client already has something at that time (checked by the database).
            raise SlotTaken() from None
        if status_ == Booking.Status.CONFIRMED:
            _on_confirmed(booking, now)
        _announce_new(booking, connection)
        return booking, True


def _booking_for_change(booking_id, *, user):
    """The booking (locked after its collaboration), if the user is its coach or client."""
    row = Booking.objects.filter(pk=booking_id).values('connection_id', 'coach_id', 'client_id').first()
    if row is None or user.pk not in (row['coach_id'], row['client_id']):
        raise NotFound()
    connection = _lock_connection(row['connection_id'])
    return Booking.objects.select_for_update().get(pk=booking_id), connection


def confirm(booking_id, *, user):
    with transaction.atomic():
        booking, connection = _booking_for_change(booking_id, user=user)
        if user.pk != booking.coach_id:
            raise NotFound()
        now = timezone.now()
        if booking.status == Booking.Status.CONFIRMED:
            return booking
        if booking.status != Booking.Status.REQUESTED or booking.starts_at <= now:
            raise BookingChanged()
        booking.status = Booking.Status.CONFIRMED
        booking.decided_at = now
        booking.save(update_fields=['status', 'decided_at', 'updated_at'])
        _on_confirmed(booking, now)
        notify(connection.client, title='POMAK', body=_('Your session is confirmed.'), url='/trener', tag=f'booking-{booking.pk}')
        return booking


def decline(booking_id, *, user, reason=''):
    with transaction.atomic():
        booking, connection = _booking_for_change(booking_id, user=user)
        if user.pk != booking.coach_id:
            raise NotFound()
        if booking.status == Booking.Status.DECLINED:
            return booking
        if booking.status != Booking.Status.REQUESTED:
            raise BookingChanged()
        booking.status = Booking.Status.DECLINED
        booking.decided_at = timezone.now()
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


def cancel(booking_id, *, user, reason='', charge=False):
    """The client until the coach's deadline (or any time while only requested); the coach until
    the session is over, and he decides whether a late cancellation still uses the package."""
    with transaction.atomic():
        booking, connection = _booking_for_change(booking_id, user=user)
        now = timezone.now()
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
        booking.charged = bool(by_coach and charge and booking.package_id)
        booking.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'charged', 'updated_at'])
        if booking.package_id and not booking.charged:
            keep_used_non_negative(booking.package_id)
        if by_coach:
            notify(connection.client, title='POMAK', body=_('Your coach cancelled a session.'), url='/trener', tag=f'booking-{booking.pk}')
        else:
            notify(connection.coach, title=display_name(connection.client), body=_('Cancelled a session.'),
                   url='/trener/kalendar', tag=f'booking-{booking.pk}')
        return booking


def cancel_future_of(connection, now=None):
    """The collaboration ended: its future sessions are cancelled (call with it locked). Their
    sessions go back to the packages, which stay at zero used or more, as for any cancellation."""
    now = now or timezone.now()
    future = Booking.objects.filter(connection=connection, status__in=Booking.HOLDS_TIME, starts_at__gt=now)
    packages = set(future.exclude(package__isnull=True).values_list('package_id', flat=True))
    future.update(status=Booking.Status.CANCELLED, cancelled_at=now, cancelled_by=Booking.By.SYSTEM, updated_at=now)
    for package_id in packages:
        keep_used_non_negative(package_id)


def _announce_new(booking, connection):
    if booking.created_by == Booking.By.COACH:
        notify(connection.client, title='POMAK', body=_('Your coach booked a session for you.'), url='/trener', tag=f'booking-{booking.pk}')
        return
    body = _('Booked a session.') if booking.status == Booking.Status.CONFIRMED else _('Requested a session.')
    notify(connection.coach, title=display_name(connection.client), body=body, url='/trener/kalendar', tag=f'booking-{booking.pk}')


def _on_confirmed(booking, now):
    """A confirmed session: it uses a package (if the client has one) and gets reminders."""
    package = package_for(booking)
    if package is not None:
        booking.package = package
        booking.save(update_fields=['package', 'updated_at'])
    create_reminders(booking, now)


# ---- packages -------------------------------------------------------------------------------

def _used_counts(packages):
    rows = (Booking.objects.filter(package__in=packages)
            .filter(Q(status=Booking.Status.CONFIRMED) | Q(status=Booking.Status.CANCELLED, charged=True))
            .values('package_id').annotate(n=Count('id')))
    return {r['package_id']: r['n'] for r in rows}


def keep_used_non_negative(package_id):
    """A session given back after the coach corrected the count downwards: the correction absorbs
    it, so "used" never goes below zero (call with the collaboration locked)."""
    package = SessionPackage.objects.select_for_update().get(pk=package_id)
    used = package_used(package)
    if used < 0:
        package.adjustment -= used
        package.save(update_fields=['adjustment', 'updated_at'])


def counted(package) -> int:
    """Sessions from the calendar that use the package (without the coach's correction)."""
    return _used_counts([package]).get(package.pk, 0)


def package_used(package) -> int:
    return _used_counts([package]).get(package.pk, 0) + package.adjustment


def package_for(booking):
    """The package a confirmed session uses: the oldest open one valid on its day with sessions
    left (call with the collaboration locked, so two sessions never take the last one)."""
    day = booking.starts_at.astimezone(LOCAL).date()
    candidates = list(SessionPackage.objects.filter(
        connection_id=booking.connection_id, closed_at__isnull=True, valid_from__lte=day,
    ).filter(Q(expires_on__isnull=True) | Q(expires_on__gte=day)).order_by('expires_on', 'valid_from', 'created_at'))
    used = _used_counts(candidates)
    for package in candidates:
        if package.total - used.get(package.pk, 0) - package.adjustment > 0:
            return package
    return None


def package_summary(package, today=None):
    today = today or timezone.localdate()
    used = package_used(package)
    sessions = (Booking.objects.filter(package=package)
                .filter(Q(status=Booking.Status.CONFIRMED) | Q(status=Booking.Status.CANCELLED, charged=True))
                .order_by('-starts_at')[:30])
    return {
        'id': str(package.id), 'name': package.name, 'total': package.total, 'used': used,
        'remaining': max(0, package.total - used), 'adjustment': package.adjustment,
        'valid_from': package.valid_from, 'expires_on': package.expires_on, 'note': package.note,
        'closed': package.closed_at is not None,
        'expired': bool(package.expires_on and package.expires_on < today),
        'sessions': [{'id': str(b.id), 'starts_at': b.starts_at, 'type_name': b.type_name,
                      'status': b.status, 'charged': b.charged} for b in sessions],
    }


# ---- reminders ------------------------------------------------------------------------------
#
# A reminder row is written with the confirmation; nothing is published from the booking request
# itself except the request's single bounded hand-off. The queue worker sends due reminders and
# plans its one next wake-up for the earliest due reminder (`notifications.push.plan_wakeup`).
# The unread poll and the daily cron recover a wake-up that was lost.

def create_reminders(booking, now):
    """Reminders 24 h and 1 h before a confirmed session (only those still ahead)."""
    from notifications.push import request_handoff

    for hours in REMINDER_HOURS:
        due = booking.starts_at - timedelta(hours=hours)
        if due > now:
            BookingReminder.objects.update_or_create(
                booking=booking, hours_before=hours,
                defaults={'due_at': due, 'for_start': booking.starts_at, 'sent_at': None, 'scheduled_at': None},
            )
    request_handoff()


def next_reminder_due(now=None):
    """When the next reminder is due (now if one is due already and still worth sending)."""
    now = now or timezone.now()
    due = (BookingReminder.objects.filter(sent_at__isnull=True, due_at__gt=now - REMINDER_GRACE)
           .order_by('due_at').values_list('due_at', flat=True).first())
    return None if due is None else max(due, now)


def _reminder_stands(booking, reminder, now) -> bool:
    return (booking.status == Booking.Status.CONFIRMED and booking.starts_at == reminder.for_start
            and booking.starts_at > now and now - reminder.due_at <= REMINDER_GRACE)


def reminder_guard(guard) -> bool:
    """Right before a queued reminder is sent: the session still stands at that time."""
    booking = Booking.objects.filter(pk=guard.get('booking')).only('status', 'starts_at').first()
    return bool(booking and booking.status == Booking.Status.CONFIRMED and booking.starts_at.isoformat() == guard.get('start'))


def send_due_reminders(now=None, *, budget=None, limit=50) -> bool:
    """Send the reminders that are due, if their session still stands as it was. Returns True if
    due reminders are left (time or batch limit), so the caller continues in a new call.

    Each one is handled under the same lock order as booking changes (collaboration, booking,
    reminder), so a cancellation or an end of the collaboration either happens first (no
    reminder) or after it is queued; a queued reminder is checked again right before sending
    and expires when the session starts.
    """
    import time as clock

    from notifications.push import notify

    deadline = clock.monotonic() + budget if budget else None
    fixed_now = now
    now = now or timezone.now()
    rows = list(BookingReminder.objects.filter(sent_at__isnull=True, due_at__lte=now)
                .order_by('due_at').values_list('pk', 'booking__connection_id', 'booking_id')[:limit + 1])
    busy_left = False
    for reminder_id, connection_id, booking_id in rows[:limit]:
        if deadline and clock.monotonic() > deadline:
            return True
        with transaction.atomic():
            # Never wait: a collaboration or booking busy right now (a cancellation in progress)
            # is skipped and handled by the next call, so the time budget holds.
            if not CoachConnection.objects.select_for_update(skip_locked=True).filter(pk=connection_id).exists():
                busy_left = True
                continue
            booking = (Booking.objects.select_for_update(skip_locked=True, of=('self',)).select_related('client__profile')
                       .filter(pk=booking_id).first())
            reminder = BookingReminder.objects.select_for_update(skip_locked=True).filter(pk=reminder_id, sent_at__isnull=True).first()
            if booking is None or reminder is None:
                busy_left = busy_left or BookingReminder.objects.filter(pk=reminder_id, sent_at__isnull=True).exists()
                continue
            now = fixed_now or timezone.now()  # after the locks
            reminder.sent_at = now
            reminder.save(update_fields=['sent_at'])
            if not _reminder_stands(booking, reminder, now):
                continue
            at = booking.starts_at.astimezone(LOCAL).strftime('%H:%M')
            # Formatted in the recipient's language when the notification is queued.
            body = format_lazy(_('Reminder: your session starts at {time}.') if reminder.hours_before <= 1
                               else _('Reminder: you have a session tomorrow at {time}.'), time=at)
            notify(booking.client, title='POMAK', body=body, url='/trener', tag=f'reminder-{booking.pk}',
                   valid_until=min(booking.starts_at, reminder.due_at + REMINDER_GRACE),
                   guard={'kind': 'booking_reminder', 'booking': str(booking.pk), 'start': booking.starts_at.isoformat()})
    return len(rows) > limit or busy_left
