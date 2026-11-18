"""The week in review ("Nedelja"): the week's facts plus the athlete's own check-in.

The facts are the week overview (workouts, nutrition, weight) plus training totals, how the
coach's plan went and the average readiness. A coach gets the same review with only what the
client shares: measurements, nutrition and readiness each need their consent; the check-in is
written for the coach and is part of the review.
"""

import datetime
from decimal import Decimal

from django.utils import timezone

from training.readiness import readiness_answers, readiness_score
from training.stats import _sessions, _totals

from .models import WeeklyCheckIn
from .overview import week_overview

CHECKIN_FIELDS = ('energy', 'progress', 'nutrition', 'satisfaction', 'hardest', 'notes')
CHECKIN_WEEKS_BACK = 8


def _plan(user, monday):
    """Planned workouts in this week, day by day from the plan of the collaboration that was
    active on that day (also an ended one: the past does not change when a coach goes or comes).
    Only the count is given, never another coach's plan itself."""
    from coaching.models import ClientPlan
    from coaching.plans import version_on

    plans = list(ClientPlan.objects.filter(connection__client=user).select_related('connection').order_by('connection__created_at'))
    if not plans:
        return None
    versions = {plan.id: list(plan.versions.prefetch_related('days').order_by('valid_from', 'created_at')) for plan in plans}

    def active_on(plan, day):
        start = timezone.localtime(plan.connection.created_at).date()
        end = timezone.localtime(plan.connection.ended_at).date() if plan.connection.ended_at else None
        return start <= day and (end is None or day < end)

    planned, covered = 0, False
    for offset in range(7):
        day = monday + datetime.timedelta(days=offset)
        plan = next((p for p in reversed(plans) if active_on(p, day)), None)
        if plan is None:
            continue
        covered = True
        version = version_on(versions[plan.id], day)
        if version and any(d.weekday == day.weekday() and d.prescription for d in version.days.all()):
            planned += 1
    return {'planned': planned} if covered else None


def _readiness(sessions):
    scores = [readiness_score(readiness_answers(s)) for s in sessions]
    scores = [s for s in scores if s is not None]
    if not scores:
        return None
    return {'avg_score': round(sum(scores) / len(scores)), 'checkins': len(scores)}


def checkin_summary(checkin):
    if checkin is None:
        return None
    return {**{f: getattr(checkin, f) for f in CHECKIN_FIELDS}, 'updated_at': checkin.updated_at}


def week_review(user, monday, *, measurements=True, nutrition=True, readiness=True, coach_connection=None):
    """For the athlete (no coach_connection): everything, and whether his check-in is shared with
    his current coach. For a coach: only what is shared, and the check-in only if it was written
    for this very collaboration (never a private note, never one meant for another coach)."""
    sunday = monday + datetime.timedelta(days=6)
    overview = week_overview(user, monday)
    sessions = _sessions(user, monday, sunday)
    training = _totals(sessions)
    training['volume_kg'] = str(Decimal(training['volume_kg']))
    return {
        'week_start': monday,
        'week_end': sunday,
        'workouts': overview['workouts'],
        'training': training,
        'plan': _plan(user, monday),
        'weight': overview['weight'] if measurements else None,
        'nutrition': overview['nutrition'] if nutrition else None,
        'readiness': _readiness(sessions) if readiness else None,
        'shared': {'measurements': measurements, 'nutrition': nutrition, 'readiness': readiness},
        'check_in': _checkin(user, monday, coach_connection),
    }


def _checkin(user, monday, coach_connection):
    checkin = WeeklyCheckIn.objects.filter(user=user, week_start=monday).first()
    if checkin is None:
        return None
    if coach_connection is not None:
        return checkin_summary(checkin) if checkin.shared_with_id == coach_connection.id else None
    from coaching.models import CoachConnection

    active = CoachConnection.objects.filter(client=user, ended_at__isnull=True).values_list('id', flat=True).first()
    return {**checkin_summary(checkin), 'shared_with_coach': active is not None and checkin.shared_with_id == active}


def can_check_in(monday) -> bool:
    """This week or one of the last few; never a week that has not started."""
    this_monday = timezone.localdate() - datetime.timedelta(days=timezone.localdate().weekday())
    return this_monday - datetime.timedelta(weeks=CHECKIN_WEEKS_BACK) <= monday <= this_monday
