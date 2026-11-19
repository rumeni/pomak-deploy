"""Free slots: weekly working hours, plus extra open time, minus closed time and taken bookings.

Working hours are wall-clock times in the schedule zone; they are turned into instants first,
and everything else (durations, steps, overlaps, notice) is computed on instants (UTC). So a
120-minute session is 120 real minutes also across a clock change, and a local time that does
not exist (spring forward) is never offered.
"""

from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.conf import settings as django_settings
from django.db import connection as db
from django.db.models import Q

from .models import Booking, BookingSettings, ScheduleException, WorkingHours

SCHEDULE_TIME_ZONE = django_settings.TIME_ZONE
LOCAL = ZoneInfo(SCHEDULE_TIME_ZONE)
UTC = dt_timezone.utc
SCHEDULE_LOCK = 7401  # advisory lock class: one coach's schedule


def lock_schedule(coach_id):
    """One change to a coach's schedule at a time: configuration changes, and a booking between
    its availability check and its insert. Taken after the collaboration lock (when there is one),
    never before it; held until the transaction ends."""
    value = coach_id.int & 0xFFFFFFFF
    with db.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(%s, %s)', [SCHEDULE_LOCK, value - (1 << 32) if value >= (1 << 31) else value])


def local_instant(day: date, at: time) -> datetime:
    """The instant of a wall-clock time on a schedule day, in UTC. A time skipped by a spring
    clock change moves forward by the gap (02:30 -> 03:30); a repeated autumn time is the first
    of the two (PEP 495, fold=0)."""
    return datetime.combine(day, at).replace(tzinfo=LOCAL).astimezone(UTC)


def day_bounds(first: date, last: date):
    """[start of `first`, start of the day after `last`) in the schedule zone, as instants."""
    return local_instant(first, time.min), local_instant(last + timedelta(days=1), time.min)


def booking_settings(coach) -> BookingSettings:
    return BookingSettings.objects.filter(coach=coach).first() or BookingSettings(coach=coach)


def _merge(intervals):
    out = []
    for start, end in sorted(intervals):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def _subtract(intervals, cuts):
    result = []
    for start, end in intervals:
        pieces = [(start, end)]
        for cut_start, cut_end in cuts:
            next_pieces = []
            for a, b in pieces:
                if cut_end <= a or cut_start >= b:
                    next_pieces.append((a, b))
                    continue
                if a < cut_start:
                    next_pieces.append((a, cut_start))
                if cut_end < b:
                    next_pieces.append((cut_end, b))
            pieces = next_pieces
        result.extend(pieces)
    return result


def open_windows(coach, first: date, last: date):
    """Bookable windows (UTC instants) of these schedule days, clipped to them."""
    start, end = day_bounds(first, last)
    hours = list(WorkingHours.objects.filter(coach=coach))
    windows = []
    day = first
    while day <= last:
        for h in hours:
            if h.weekday == day.weekday():
                window = (local_instant(day, h.start_time), local_instant(day, h.end_time))
                if window[1] > window[0]:
                    windows.append(window)
        day += timedelta(days=1)
    exceptions = list(ScheduleException.objects.filter(coach=coach, starts_at__lt=end, ends_at__gt=start))
    windows += [(max(e.starts_at, start), min(e.ends_at, end)) for e in exceptions if e.kind == ScheduleException.Kind.OPEN]
    windows = _merge([(a.astimezone(UTC), b.astimezone(UTC)) for a, b in windows])
    return _subtract(windows, [(e.starts_at, e.ends_at) for e in exceptions if e.kind == ScheduleException.Kind.CLOSED])


def busy(coach, start, end, *, client=None):
    """Times already held by the coach's (or this client's) requested or confirmed bookings."""
    who = Q(coach=coach) | Q(client=client) if client is not None else Q(coach=coach)
    return [(b.starts_at, b.ends_at) for b in Booking.objects.filter(
        who, status__in=Booking.HOLDS_TIME, starts_at__lt=end, ends_at__gt=start,
    )]


def free_slots(coach, duration_minutes, first: date, last: date, *, now, client=None):
    """Start instants (UTC) a client can book for a session of this length, in order.

    Slots sit on a fixed grid of each schedule day: every `slot_step_minutes` of real time from
    that day's local midnight. The grid never depends on the dates asked for, so a slot listed
    for a week is exactly the one accepted when booking that day. A slot belongs to the day it
    starts on and may run past midnight within open time.
    """
    rules = booking_settings(coach)
    earliest = now + timedelta(hours=rules.min_notice_hours)
    latest = now + timedelta(days=rules.horizon_days)
    duration = timedelta(minutes=duration_minutes)
    step = timedelta(minutes=max(5, rules.slot_step_minutes))
    # One extra day on both sides: open time crossing midnight belongs to the window it is part of.
    windows = open_windows(coach, first - timedelta(days=1), last + timedelta(days=1))
    if not windows:
        return []
    taken = busy(coach, windows[0][0], windows[-1][1], client=client)
    slots = []
    day = first
    while day <= last:
        grid, day_end = day_bounds(day, day)
        for start, end in windows:
            if end <= grid or start >= day_end:
                continue
            # The first grid point at or after the window's start (within this day).
            k = max(0, -(-(max(start, grid) - grid) // step))
            t = grid + k * step
            while t < day_end and t + duration <= end:
                if earliest <= t <= latest and not any(t < b_end and t + duration > b_start for b_start, b_end in taken):
                    slots.append(t)
                t += step
        day += timedelta(days=1)
    return sorted(set(slots))


def is_free_slot(coach, duration_minutes, starts_at, *, now, client=None) -> bool:
    """The same rule as `free_slots`, for the day the instant falls on."""
    instant = starts_at.astimezone(UTC)
    day = instant.astimezone(LOCAL).date()
    return instant in free_slots(coach, duration_minutes, day, day, now=now, client=client)
