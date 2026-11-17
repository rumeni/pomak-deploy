"""Training statistics and readiness history for one period (7, 30, 90 days or all).

How the numbers are made (shown to the athlete as well):
- Only working sets count; warm-ups do not.
- Sets per muscle group use the exercise's main muscle group only.
- Volume = weight x reps of working sets with weight (exercises measured in weight and reps),
  x2 for weights given per dumbbell / side - the same as the end-of-workout summary.
- Average RPE is over working sets that have an RPE logged; how many is returned too.
- Estimated 1RM: see progress.estimated_1rm (RPE chart for RPE 6+, Epley otherwise, 1-10 reps).
- A day is the local (Europe/Belgrade) date the workout started; weeks start on Monday.
"""

import datetime
from collections import defaultdict
from decimal import Decimal

from django.db.models import Prefetch
from django.utils import timezone

from core.i18n import localized_name

from .models import READINESS_FIELDS, Exercise, RoutineSet, SessionExercise, WorkoutSession
from .progress import MAX_E1RM_REPS, estimated_1rm

PERIODS = {'7': 7, '30': 30, '90': 90, 'all': None}
MAX_WEEKS = 26
TOP_LIFTS = 8
E1RM_MEASUREMENTS = {Exercise.Measurement.WEIGHT_REPS, Exercise.Measurement.WEIGHTED_BODYWEIGHT}


def _local_start(day: datetime.date) -> datetime.datetime:
    return timezone.make_aware(datetime.datetime.combine(day, datetime.time.min))


def _monday(day: datetime.date) -> datetime.date:
    return day - datetime.timedelta(days=day.weekday())


def _sessions(user, first: datetime.date | None, last: datetime.date):
    qs = WorkoutSession.objects.filter(owner=user, started_at__lt=_local_start(last + datetime.timedelta(days=1)))
    if first is not None:
        qs = qs.filter(started_at__gte=_local_start(first))
    return list(qs.order_by('started_at').prefetch_related(
        Prefetch('exercises', queryset=SessionExercise.objects.select_related('exercise').prefetch_related('sets')),
    ))


class _Totals:
    """Running totals for a group of workouts (a period, a week, one workout)."""

    def __init__(self):
        self.sessions = 0
        self.working_sets = 0
        self.volume = Decimal(0)
        self.rpe_sum = Decimal(0)
        self.rpe_sets = 0

    def add_session(self, session):
        self.sessions += 1
        for item in session.exercises.all():
            factor = 2 if item.exercise.load_mode == Exercise.LoadMode.PER_SIDE else 1
            for s in item.sets.all():
                if s.set_type != RoutineSet.SetType.WORKING:
                    continue
                self.working_sets += 1
                if item.exercise.measurement == Exercise.Measurement.WEIGHT_REPS and s.weight_kg is not None and s.reps:
                    self.volume += s.weight_kg * s.reps * factor
                if s.rpe is not None:
                    self.rpe_sum += s.rpe
                    self.rpe_sets += 1

    def as_dict(self) -> dict:
        return {
            'sessions': self.sessions,
            'working_sets': self.working_sets,
            'volume_kg': str(self.volume.quantize(Decimal('1'))),
            'avg_rpe': str((self.rpe_sum / self.rpe_sets).quantize(Decimal('0.1'))) if self.rpe_sets else None,
            'rpe_sets': self.rpe_sets,
        }


def _totals(sessions) -> dict:
    t = _Totals()
    for s in sessions:
        t.add_session(s)
    return t.as_dict()


def _best_e1rm(sessions) -> dict:
    """Best estimated 1RM per exercise in these workouts: {exercise_id: (e1rm, set, session)}."""
    best = {}
    for session in sessions:
        for item in session.exercises.all():
            if item.exercise.measurement not in E1RM_MEASUREMENTS:
                continue
            for s in item.sets.all():
                if s.set_type != RoutineSet.SetType.WORKING or s.weight_kg is None or not s.reps:
                    continue
                if s.reps > MAX_E1RM_REPS or s.weight_kg <= 0:
                    continue
                value = estimated_1rm(s.weight_kg, s.reps, s.rpe)
                current = best.get(item.exercise_id)
                if current is None or value > current[0]:
                    best[item.exercise_id] = (value, s, session, item.exercise)
    return best


def training_stats(user, period: str) -> dict:
    days = PERIODS[period]
    today = timezone.localdate()
    first = today - datetime.timedelta(days=days - 1) if days else None
    sessions = _sessions(user, first, today)

    # Comparison with the period of the same length just before (not for "all").
    previous = None
    if days:
        before = _sessions(user, first - datetime.timedelta(days=days), first - datetime.timedelta(days=1))
        previous = _totals(before)

    # Weekly series, Monday to Sunday, empty weeks included.
    start = _monday(first) if first else (_monday(timezone.localtime(sessions[0].started_at).date()) if sessions else _monday(today))
    start = max(start, _monday(today) - datetime.timedelta(weeks=MAX_WEEKS - 1))
    weeks = {start + datetime.timedelta(weeks=i): _Totals() for i in range((_monday(today) - start).days // 7 + 1)}
    muscles = defaultdict(int)
    for session in sessions:
        week = weeks.get(_monday(timezone.localtime(session.started_at).date()))
        if week is not None:
            week.add_session(session)
        for item in session.exercises.all():
            muscles[item.exercise.muscle] += sum(1 for s in item.sets.all() if s.set_type == RoutineSet.SetType.WORKING)

    # Best estimated 1RM per exercise in the period, flagged when it is also the all-time best.
    period_best = _best_e1rm(sessions)
    all_time = _best_e1rm(_sessions(user, None, today)) if days else period_best
    top = sorted(period_best.items(), key=lambda kv: kv[1][0], reverse=True)[:TOP_LIFTS]

    return {
        'period': period,
        'first_day': first,
        'last_day': today,
        'totals': _totals(sessions),
        'previous': previous,
        'weeks': [{'week_start': monday, **t.as_dict()} for monday, t in weeks.items()],
        'muscles': sorted(
            ({'muscle': muscle, 'working_sets': count} for muscle, count in muscles.items() if count),
            key=lambda m: m['working_sets'], reverse=True,
        ),
        'top_lifts': [
            {
                'exercise_id': exercise_id,
                'exercise': localized_name(exercise),
                'e1rm': str(value.quantize(Decimal('0.1'))),
                'weight_kg': str(s.weight_kg),
                'reps': s.reps,
                'rpe': str(s.rpe) if s.rpe is not None else None,
                'date': timezone.localtime(session.started_at).date(),
                'session_id': session.id,
                'personal_best': all_time[exercise_id][0] == value,
            }
            for exercise_id, (value, s, session, exercise) in top
        ],
        'readiness': readiness_history(sessions),
    }


def readiness_history(sessions) -> list[dict]:
    """Workouts with a check-in, oldest first, with what was done in them."""
    entries = []
    for session in sessions:
        answers = {f: getattr(session, f) for f in READINESS_FIELDS}
        if all(v is None for v in answers.values()):
            continue
        t = _Totals()
        t.add_session(session)
        entries.append({
            'session_id': session.id,
            'date': timezone.localtime(session.started_at).date(),
            'name': session.name,
            'readiness': answers,
            **{k: v for k, v in t.as_dict().items() if k != 'sessions'},
        })
    return entries
