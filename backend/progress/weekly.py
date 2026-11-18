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
    """Planned workouts from the coach's plan in this week, if the athlete has one."""
    from coaching.models import ClientPlan, CoachConnection
    from coaching.plans import version_on

    connection = CoachConnection.objects.filter(client=user, ended_at__isnull=True).first()
    plan = ClientPlan.objects.filter(connection=connection).first() if connection else None
    if plan is None:
        return None
    versions = list(plan.versions.prefetch_related('days').order_by('valid_from', 'created_at'))
    planned = 0
    for offset in range(7):
        day = monday + datetime.timedelta(days=offset)
        version = version_on(versions, day)
        if version and any(d.weekday == day.weekday() and d.routine_id for d in version.days.all()):
            planned += 1
    return {'planned': planned}


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


def week_review(user, monday, *, measurements=True, nutrition=True, readiness=True):
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
        'check_in': checkin_summary(WeeklyCheckIn.objects.filter(user=user, week_start=monday).first()),
    }


def can_check_in(monday) -> bool:
    """This week or one of the last few; never a week that has not started."""
    this_monday = timezone.localdate() - datetime.timedelta(days=timezone.localdate().weekday())
    return this_monday - datetime.timedelta(weeks=CHECKIN_WEEKS_BACK) <= monday <= this_monday
