"""Stanje ciljeva napretka i nedeljni pregled.

Nedelja počinje ponedeljkom; dan treninga je lokalni datum početka (Europe/Belgrade).
Prosek ishrane se računa SAMO iz dana koje je korisnik označio kao kompletne, i uvek uz
podatak koliko je takvih dana (AC-05): nepotpun dan bi lažno spustio prosek.
"""

import datetime
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone

from nutrition.models import MealEntry, NutritionDay, NutritionTarget
from training.models import WorkoutSession

from .models import Goal, Measurement

MACROS = ('protein_g', 'carbs_g', 'fat_g')


def monday_of(day: datetime.date) -> datetime.date:
    return day - datetime.timedelta(days=day.weekday())


def _local_start(day: datetime.date) -> datetime.datetime:
    return timezone.make_aware(datetime.datetime.combine(day, datetime.time.min))


def workouts_between(user, first: datetime.date, last: datetime.date) -> int:
    """Broj treninga od `first` do `last` (uključivo), po lokalnom datumu početka."""
    return WorkoutSession.objects.filter(
        owner=user, started_at__gte=_local_start(first), started_at__lt=_local_start(last + datetime.timedelta(days=1)),
    ).count()


def latest_measurement(user, kind, before: datetime.date | None = None):
    qs = Measurement.objects.filter(user=user, kind=kind)
    if before is not None:
        qs = qs.filter(measured_on__lt=before)
    return qs.order_by('-measured_on', '-created_at').first()


def goal_state(goal: Goal, today: datetime.date) -> dict:
    """Trenutna vrednost i koliko je cilj blizu (0–1). Stanje (ostvaren) i dalje bira korisnik."""
    if goal.kind == Goal.Kind.WORKOUTS:
        monday = monday_of(today)
        weeks = []
        for back in range(4, 0, -1):
            start = monday - datetime.timedelta(weeks=back)
            weeks.append({'week_start': start, 'count': workouts_between(goal.user, start, start + datetime.timedelta(days=6))})
        current = workouts_between(goal.user, monday, monday + datetime.timedelta(days=6))
        target = int(goal.target_value)
        return {
            'current': current,
            'current_date': None,
            'progress': min(1.0, current / target) if target else 1.0,
            'reached': current >= target,
            'recent_weeks': [{**w, 'met': w['count'] >= target} for w in weeks],
        }

    latest = latest_measurement(goal.user, goal.kind)
    if latest is None:
        return {'current': None, 'current_date': None, 'progress': 0.0, 'reached': False}
    start, target, current = goal.start_value, goal.target_value, latest.value
    down = target < start
    reached = current <= target if down else current >= target
    span = start - target
    progress = 1.0 if span == 0 else float((start - current) / span)
    return {
        'current': str(current),
        'current_date': latest.measured_on,
        'progress': max(0.0, min(1.0, progress)),
        'reached': reached,
    }


def _avg(values, places: str):
    values = [v for v in values if v is not None]
    if not values:
        return None
    return str((sum(values, Decimal(0)) / len(values)).quantize(Decimal(places)))


def week_overview(user, monday: datetime.date) -> dict:
    sunday = monday + datetime.timedelta(days=6)
    days = [monday + datetime.timedelta(days=i) for i in range(7)]

    totals = {
        row['date']: row
        for row in MealEntry.objects.filter(owner=user, date__range=(monday, sunday)).values('date').annotate(
            entries=Count('id'),
            sum_kcal=Sum('kcal'),
            **{f'sum_{m}': Sum(m) for m in MACROS},
            **{f'{m}_unknown': Count('id', filter=Q(**{f'{m}__isnull': True})) for m in MACROS},
        )
    }
    statuses = dict(NutritionDay.objects.filter(owner=user, date__range=(monday, sunday)).values_list('date', 'status'))
    complete = [d for d in days if statuses.get(d) == NutritionDay.Status.COMPLETE]

    targets = [NutritionTarget.for_date(user, d) for d in complete]
    nutrition = {
        'days': [
            {
                'date': d,
                'status': statuses.get(d),
                'entries': totals.get(d, {}).get('entries', 0),
                'kcal': str(totals[d]['sum_kcal']) if d in totals else None,
            }
            for d in days
        ],
        'complete_days': len(complete),
        'avg_kcal': _avg([totals[d]['sum_kcal'] if d in totals else Decimal(0) for d in complete], '1'),
        # Prosek poznatih vrednosti + broj stavki bez podatka (nepoznato nije 0).
        **{f'avg_{m}': _avg([totals[d][f'sum_{m}'] if d in totals else Decimal(0) for d in complete], '0.1') for m in MACROS},
        **{f'{m}_unknown': sum(totals[d][f'{m}_unknown'] for d in complete if d in totals) for m in MACROS},
        'avg_target_kcal': _avg([Decimal(t.kcal) for t in targets if t], '1'),
    }

    workouts_goal = Goal.objects.filter(user=user, kind=Goal.Kind.WORKOUTS, status=Goal.Status.ACTIVE).first()
    workouts_target = int(workouts_goal.target_value) if workouts_goal else user.profile.weekly_workouts_target

    latest = latest_measurement(user, Measurement.Kind.WEIGHT, before=sunday + datetime.timedelta(days=1))
    in_week = latest is not None and latest.measured_on >= monday
    previous = latest_measurement(user, Measurement.Kind.WEIGHT, before=monday) if in_week else None
    weight = None
    if in_week:
        weight = {
            'latest': str(latest.value),
            'latest_date': latest.measured_on,
            'previous': str(previous.value) if previous else None,
            'previous_date': previous.measured_on if previous else None,
            'change': str(latest.value - previous.value) if previous else None,
        }

    return {
        'week_start': monday,
        'week_end': sunday,
        'workouts': {'count': workouts_between(user, monday, sunday), 'target': workouts_target},
        'nutrition': nutrition,
        'weight': weight,
    }
