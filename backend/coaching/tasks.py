"""Tasks on the coach's overview, raised from facts the coach may already see.

Each event raises one task (unique connection + kind + key), so the same warning never repeats:
a task the coach closed stays closed. The texts are facts ("no workouts for 9 days"), never
conclusions about the client.

- workout_review: a finished workout (key: the workout).
- low_readiness: the check-in before a workout scored below LOW_READINESS (key: the workout).
  Only while the client shares readiness; revoking that consent deletes these tasks.
- personal_record: a workout beat the client's earlier best estimated 1RM in a lift (key: the workout).
- inactive: no workout for INACTIVE_DAYS (key: the start of that period). Closes by itself when the
  client trains again or is paused; paused clients never raise it.

Finding new workouts. A workout logged offline reaches the server later with an older start
time, so workouts are taken in the order the SERVER stored them, with a forward cursor
(created_at, id) that always moves on - many workouts stored in the same instant cannot make it
stall. A transaction that committed after a later one can land behind the cursor; a separate,
bounded pass over the last LOOK_BACK picks up such workouts that still have no review task.

Workout tasks follow their workout: a corrected workout updates (or drops) its tasks, a deleted
one removes them (see coaching/signals.py), so no stale facts stay in the inbox. Records are
current facts, not snapshots: correcting or deleting a workout also re-judges the records of
the later workouts.

Every writer of a collaboration's tasks (sync, reconciliation, a deleted workout, a consent
change, the end, a coach's action) first locks that collaboration row and re-reads it. So a
sync can never insert facts after consent was revoked or the collaboration ended, and a
deleted workout cannot get its tasks back from a sync that read it just before.
"""

from collections import defaultdict
from datetime import timedelta

from django.db import transaction
from django.db.models import CharField, Exists, Max, OuterRef, Q
from django.db.models.functions import Cast
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
WORKOUT_KINDS = (CoachTask.Kind.WORKOUT_REVIEW, CoachTask.Kind.LOW_READINESS, CoachTask.Kind.PERSONAL_RECORD)
MAX_OPEN_TASKS = 300
MAX_OTHER_TASKS = 100
# Later workouts whose records are judged again after a correction (newest collaboration first).
MAX_LATER_RECORDS = 100


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
    """Lifts where this workout beat every earlier workout of the client (a first lift is no record).

    Judged on the current data of the workouts, so a corrected workout is judged again correctly.
    """
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
    """The tasks one workout should have now (unsaved)."""
    event_at = session.finished_at or session.started_at
    base = {'workout_id': str(session.id), 'workout': session.name}
    tasks = [CoachTask(connection=connection, kind=CoachTask.Kind.WORKOUT_REVIEW, key=str(session.id),
                       event_at=event_at, data=base)]
    if connection.share_readiness:
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


def _eligible_workouts(connection):
    # Workouts finished before the collaboration are history, not tasks.
    return WorkoutSession.objects.filter(owner_id=connection.client_id, finished_at__gte=connection.created_at)


def _with_details(queryset):
    return queryset.prefetch_related('exercises__exercise', 'exercises__sets')


def _sync_workouts(connection) -> None:
    eligible = _eligible_workouts(connection)
    at, last_id = connection.tasks_checked_at, connection.tasks_checked_id
    ahead = eligible
    if at is not None:
        ahead = eligible.filter(Q(created_at__gt=at) | Q(created_at=at, id__gt=last_id) if last_id else Q(created_at__gt=at))
    new = list(_with_details(ahead.order_by('created_at', 'id'))[:MAX_WORKOUTS_PER_SYNC])

    # Late commits behind the cursor: bounded, and separate, so it never crowds out new work.
    late = []
    if at is not None:
        reviewed = CoachTask.objects.filter(
            connection=connection, kind=CoachTask.Kind.WORKOUT_REVIEW,
            key=Cast(OuterRef('id'), output_field=CharField()),
        )
        late = list(_with_details(
            eligible.filter(created_at__gte=at - LOOK_BACK, created_at__lte=at)
            .exclude(Exists(reviewed)).order_by('created_at', 'id')
        )[:MAX_WORKOUTS_PER_SYNC])

    sessions = new + late
    if sessions:
        CoachTask.objects.bulk_create(
            [task for session in sessions for task in _workout_tasks(connection, session)], ignore_conflicts=True,
        )
    if new:
        # Only forward: a concurrent sync that got further must not be moved back.
        moved_at, moved_id = new[-1].created_at, new[-1].id
        CoachConnection.objects.filter(pk=connection.pk).filter(
            Q(tasks_checked_at__isnull=True) | Q(tasks_checked_at__lt=moved_at)
            | Q(tasks_checked_at=moved_at, tasks_checked_id__lt=moved_id) | Q(tasks_checked_at=moved_at, tasks_checked_id__isnull=True),
        ).update(tasks_checked_at=moved_at, tasks_checked_id=moved_id)


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


def lock_active(connection_id):
    """The collaboration, locked, if it is still active. Call inside atomic()."""
    return CoachConnection.objects.select_for_update().filter(pk=connection_id, ended_at__isnull=True).first()


def sync_tasks(connections) -> None:
    """Brings the tasks of these active collaborations up to date (idempotent, safe to run concurrently)."""
    ids = [c.id for c in connections if c.ended_at is None]
    if not ids:
        return
    now = timezone.now()
    last = dict(
        WorkoutSession.objects.filter(owner_id__in=[c.client_id for c in connections])
        .values('owner_id').annotate(last=Max('started_at')).values_list('owner_id', 'last')
    )
    for connection_id in ids:
        with transaction.atomic():
            connection = lock_active(connection_id)  # consent and end are read under the lock
            if connection is None:
                continue
            _sync_workouts(connection)
            _sync_inactivity(connection, last.get(connection.client_id), now)


def _set_record_task(connection, session, records) -> None:
    task = CoachTask.objects.filter(connection=connection, kind=CoachTask.Kind.PERSONAL_RECORD, key=str(session.id)).first()
    if not records:
        if task:
            task.delete()
        return
    data = {'workout_id': str(session.id), 'workout': session.name, 'records': records}
    if task:
        task.data = data
        task.save(update_fields=['data', 'updated_at'])
    else:
        CoachTask.objects.bulk_create([CoachTask(
            connection=connection, kind=CoachTask.Kind.PERSONAL_RECORD, key=str(session.id),
            event_at=session.finished_at or session.started_at, data=data,
        )], ignore_conflicts=True)


def _rejudge_later_records(connection, owner_id, after) -> None:
    """Records of the workouts after `after` that were already turned into tasks, judged again."""
    reviewed = CoachTask.objects.filter(
        connection=connection, kind=CoachTask.Kind.WORKOUT_REVIEW, key=Cast(OuterRef('id'), output_field=CharField()),
    )
    later = _with_details(
        _eligible_workouts(connection).filter(owner_id=owner_id, started_at__gt=after).filter(Exists(reviewed))
        .order_by('-started_at')
    )[:MAX_LATER_RECORDS]
    for session in later:
        _set_record_task(connection, session, _records(session))


def reconcile_workout(session_id) -> None:
    """After a client corrects a workout: its tasks get the current facts, or go if no longer true,
    and the records of later workouts are judged again.

    The coach's action (done, snoozed) stays on a task that still applies. Workouts not turned
    into tasks yet are left to the sync.
    """
    owner_id = WorkoutSession.objects.filter(pk=session_id).values_list('owner_id', flat=True).first()
    if owner_id is None:
        return  # deleted meanwhile: the deletion removed its tasks
    for connection_id in CoachConnection.objects.filter(client_id=owner_id, ended_at__isnull=True).values_list('id', flat=True):
        with transaction.atomic():
            connection = lock_active(connection_id)
            if connection is None:
                continue
            # Read under the lock: the current workout, not one read before a concurrent change.
            session = _with_details(WorkoutSession.objects.filter(pk=session_id)).first()
            if session is None:
                return
            existing = {t.kind: t for t in CoachTask.objects.filter(connection=connection, key=str(session.id), kind__in=WORKOUT_KINDS)}
            if existing:
                wanted = {t.kind: t for t in _workout_tasks(connection, session)} if session.finished_at >= connection.created_at else {}
                for kind, task in existing.items():
                    if kind in wanted:
                        task.data, task.event_at = wanted[kind].data, wanted[kind].event_at
                        task.save(update_fields=['data', 'event_at', 'updated_at'])
                    else:
                        task.delete()
                CoachTask.objects.bulk_create([t for kind, t in wanted.items() if kind not in existing], ignore_conflicts=True)
            _rejudge_later_records(connection, owner_id, session.started_at)


def workout_deleted(session_id, owner_id, started_at) -> None:
    """A deleted workout leaves nothing about it in any inbox. Runs inside the deleting transaction:
    the collaborations are locked first, so a sync that read the workout just before cannot
    publish its tasks afterwards. Later records are judged again once the deletion committed."""
    list(CoachConnection.objects.select_for_update().filter(client_id=owner_id, ended_at__isnull=True).values_list('id', flat=True))
    remove_workout_tasks(session_id)

    def rejudge():
        for connection_id in CoachConnection.objects.filter(client_id=owner_id, ended_at__isnull=True).values_list('id', flat=True):
            with transaction.atomic():
                connection = lock_active(connection_id)
                if connection is not None:
                    _rejudge_later_records(connection, owner_id, started_at)

    transaction.on_commit(rejudge)


def remove_workout_tasks(session_id) -> None:
    CoachTask.objects.filter(key=str(session_id), kind__in=WORKOUT_KINDS).delete()


def visible_tasks(coach, now=None) -> list:
    """The coach's tasks for active collaborations: every open one first (never crowded out by
    others), then snoozed and recently done ones."""
    now = now or timezone.now()
    rows = CoachTask.objects.filter(connection__coach=coach, connection__ended_at__isnull=True).exclude(
        # Defence in depth: readiness tasks only while that consent is given.
        kind=CoachTask.Kind.LOW_READINESS, connection__share_readiness=False,
    ).select_related('connection__client__profile')
    is_open = Q(status=CoachTask.Status.OPEN)
    not_snoozed = Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now)
    return [
        *rows.filter(is_open & not_snoozed)[:MAX_OPEN_TASKS],
        *rows.filter(is_open, snoozed_until__gt=now)[:MAX_OTHER_TASKS],
        *rows.filter(status=CoachTask.Status.DONE, auto_resolved=False, resolved_at__gte=now - timedelta(days=14))[:MAX_OTHER_TASKS],
    ]


def weekly_checkin_task(connection_id, monday) -> None:
    """Raise one task only while the check-in is still explicitly shared with this coach."""
    from progress.models import WeeklyCheckIn

    with transaction.atomic():
        connection = lock_active(connection_id)
        if connection is None or not WeeklyCheckIn.objects.filter(
            user_id=connection.client_id, week_start=monday, shared_with_id=connection.pk,
        ).exists():
            return
        CoachTask.objects.bulk_create([CoachTask(
            connection=connection, kind=CoachTask.Kind.WEEKLY_CHECKIN, key=monday.isoformat(),
            event_at=timezone.now(), data={'week_start': monday.isoformat()},
        )], ignore_conflicts=True)

