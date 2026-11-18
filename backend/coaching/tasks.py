"""Tasks on the coach's overview, raised from facts the coach may already see.

Each event raises one task (unique connection + kind + key), so the same warning never repeats:
a task the coach closed stays closed. The texts are facts ("no workouts for 9 days"), never
conclusions about the client.

- workout_review: a finished workout (key: the workout).
- low_readiness: the check-in before a workout scored below LOW_READINESS (key: the workout).
- personal_record: a workout beat the client's earlier best estimated 1RM in a lift (key: the workout).
- inactive: no workout for INACTIVE_DAYS (key: the start of that period). Closes by itself when the
  client trains again or is paused; paused clients never raise it.

Workouts are found by when the SERVER stored them (created_at), since a workout logged offline
arrives later with an older start time. A short look-back covers transactions that committed
after a later one; the unique key keeps that from duplicating anything.
"""

from collections import defaultdict
from datetime import timedelta

from django.db.models import Max, Q
from django.utils import timezone

from training.models import RoutineSet, WorkoutSession
from training.progress import MAX_E1RM_REPS, estimated_1rm
from training.readiness import readiness_answers, readiness_score
from training.stats import E1RM_MEASUREMENTS

from .models import CoachConnection, CoachTask

INACTIVE_DAYS = 7
LOW_READINESS = 50
LOOK_BACK = timedelta(minutes=10)
MAX_WORKOUTS_PER_SYNC = 60


def _best_lifts(session) -> dict:
    """Best estimated 1RM per exercise in one workout: {exercise_id: (value, exercise)}."""
    best = {}
    for item in session.exercises.all():
        if item.exercise.measurement not in E1RM_MEASUREMENTS:
            continue
        for s in item.sets.all():
            if s.set_type != RoutineSet.SetType.WORKING or s.weight_kg is None or not s.reps:
                continue
            if s.reps > MAX_E1RM_REPS or s.weight_kg <= 0:
                continue
            value = estimated_1rm(s.weight_kg, s.reps, s.rpe)
            if item.exercise_id not in best or value > best[item.exercise_id][0]:
                best[item.exercise_id] = (value, item.exercise)
    return best


def _records(session) -> list:
    """Lifts where this workout beat every earlier workout of the client (a first lift is no record)."""
    lifts = _best_lifts(session)
    if not lifts:
        return []
    earlier = WorkoutSession.objects.filter(
        owner_id=session.owner_id, started_at__lt=session.started_at,
        exercises__exercise_id__in=lifts.keys(),
    ).distinct().prefetch_related('exercises__exercise', 'exercises__sets')
    previous = defaultdict(lambda: None)
    for other in earlier:
        for exercise_id, (value, _) in _best_lifts(other).items():
            if previous[exercise_id] is None or value > previous[exercise_id]:
                previous[exercise_id] = value
    return [
        # Both names: the task is stored once and read in either language.
        {'exercise_id': str(exercise_id), 'exercise': exercise.name, 'exercise_en': getattr(exercise, 'name_en', '') or '',
         'e1rm': str(value.quantize(1))}
        for exercise_id, (value, exercise) in lifts.items()
        if previous[exercise_id] is not None and value > previous[exercise_id]
    ]


def _workout_tasks(connection, session) -> list:
    event_at = session.finished_at or session.started_at
    base = {'workout_id': str(session.id), 'workout': session.name}
    tasks = [CoachTask(connection=connection, kind=CoachTask.Kind.WORKOUT_REVIEW, key=str(session.id),
                       event_at=event_at, data=base)]
    answers = readiness_answers(session)
    score = readiness_score(answers)
    if score is not None and score < LOW_READINESS:
        tasks.append(CoachTask(connection=connection, kind=CoachTask.Kind.LOW_READINESS, key=str(session.id),
                               event_at=session.started_at, data={**base, 'score': score, 'answers': answers}))
    records = _records(session)
    if records:
        tasks.append(CoachTask(connection=connection, kind=CoachTask.Kind.PERSONAL_RECORD, key=str(session.id),
                               event_at=event_at, data={**base, 'records': records}))
    return tasks


def _sync_workouts(connection, now) -> None:
    since = connection.tasks_checked_at or connection.created_at
    sessions = list(
        WorkoutSession.objects.filter(
            owner_id=connection.client_id, created_at__gt=since - LOOK_BACK,
            # Workouts finished before the collaboration are history, not tasks.
            finished_at__gte=connection.created_at,
        ).order_by('created_at').prefetch_related('exercises__exercise', 'exercises__sets')[:MAX_WORKOUTS_PER_SYNC]
    )
    if not sessions:
        return
    tasks = [task for session in sessions for task in _workout_tasks(connection, session)]
    CoachTask.objects.bulk_create(tasks, ignore_conflicts=True)
    # Only forward: a concurrent sync that got further must not be moved back.
    checked = sessions[-1].created_at
    CoachConnection.objects.filter(pk=connection.pk).filter(
        Q(tasks_checked_at__isnull=True) | Q(tasks_checked_at__lt=checked),
    ).update(tasks_checked_at=checked)


def _sync_inactivity(connection, last_workout, now) -> None:
    open_inactive = CoachTask.objects.filter(connection=connection, kind=CoachTask.Kind.INACTIVE, status=CoachTask.Status.OPEN)
    if connection.paused_at is not None:
        open_inactive.update(status=CoachTask.Status.DONE, resolved_at=now, auto_resolved=True)
        return
    since = max(filter(None, [last_workout, connection.active_since]))
    key = since.isoformat()
    # The client trained or was resumed since: the old period is over.
    open_inactive.exclude(key=key).update(status=CoachTask.Status.DONE, resolved_at=now, auto_resolved=True)
    if now - since >= timedelta(days=INACTIVE_DAYS):
        CoachTask.objects.bulk_create([CoachTask(
            connection=connection, kind=CoachTask.Kind.INACTIVE, key=key, event_at=since,
            data={'since': key, 'last_workout_at': last_workout.isoformat() if last_workout else None},
        )], ignore_conflicts=True)


def sync_tasks(connections) -> None:
    """Brings the tasks of these active collaborations up to date (idempotent, safe to run concurrently)."""
    connections = [c for c in connections if c.ended_at is None]
    if not connections:
        return
    now = timezone.now()
    last = dict(
        WorkoutSession.objects.filter(owner_id__in=[c.client_id for c in connections])
        .values('owner_id').annotate(last=Max('started_at')).values_list('owner_id', 'last')
    )
    for connection in connections:
        _sync_workouts(connection, now)
        _sync_inactivity(connection, last.get(connection.client_id), now)


def visible_tasks(coach, now=None):
    """The coach's tasks for active collaborations: open, snoozed, and recently done."""
    now = now or timezone.now()
    rows = CoachTask.objects.filter(
        connection__coach=coach, connection__ended_at__isnull=True,
    ).filter(
        Q(status=CoachTask.Status.OPEN) | Q(resolved_at__gte=now - timedelta(days=14), auto_resolved=False),
    ).select_related('connection__client__profile')
    return rows
