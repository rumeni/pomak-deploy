"""Free slots: weekly working hours, plus extra open time, minus closed time and taken bookings."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings as django_settings

from .models import Booking, BookingSettings, ScheduleException, WorkingHours

LOCAL = ZoneInfo(django_settings.TIME_ZONE)


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
    """Bookable windows (aware datetimes) between two local dates, inclusive, without bookings."""
    start = datetime.combine(first, datetime.min.time(), LOCAL)
    end = datetime.combine(last + timedelta(days=1), datetime.min.time(), LOCAL)
    hours = list(WorkingHours.objects.filter(coach=coach))
    windows = []
    day = first
    while day <= last:
        for h in hours:
            if h.weekday == day.weekday():
                windows.append((datetime.combine(day, h.start_time, LOCAL), datetime.combine(day, h.end_time, LOCAL)))
        day += timedelta(days=1)
    exceptions = ScheduleException.objects.filter(coach=coach, starts_at__lt=end, ends_at__gt=start)
    windows += [(max(e.starts_at, start), min(e.ends_at, end)) for e in exceptions if e.kind == ScheduleException.Kind.OPEN]
    windows = _merge(windows)
    return _subtract(windows, [(e.starts_at, e.ends_at) for e in exceptions if e.kind == ScheduleException.Kind.CLOSED])


def busy(coach, start, end, *, client=None):
    """Times already held by the coach's (or this client's) requested or confirmed bookings."""
    from django.db.models import Q

    who = Q(coach=coach) | Q(client=client) if client is not None else Q(coach=coach)
    return [(b.starts_at, b.ends_at) for b in Booking.objects.filter(
        who, status__in=Booking.HOLDS_TIME, starts_at__lt=end, ends_at__gt=start,
    )]


def free_slots(coach, session_type, first: date, last: date, *, now, client=None):
    """Start times a client can book for this session type, in order."""
    rules = booking_settings(coach)
    earliest = now + timedelta(hours=rules.min_notice_hours)
    latest = now + timedelta(days=rules.horizon_days)
    duration = timedelta(minutes=session_type.duration_minutes)
    step = timedelta(minutes=max(5, rules.slot_step_minutes))
    windows = open_windows(coach, first, last)
    if not windows:
        return []
    taken = busy(coach, windows[0][0], windows[-1][1], client=client)
    slots = []
    for start, end in windows:
        t = start
        while t + duration <= end:
            if earliest <= t <= latest and not any(t < b_end and t + duration > b_start for b_start, b_end in taken):
                slots.append(t)
            t += step
    return slots


def is_free_slot(coach, session_type, starts_at, *, now, client=None) -> bool:
    local_day = starts_at.astimezone(LOCAL).date()
    return starts_at in free_slots(coach, session_type, local_day, local_day, now=now, client=client)
