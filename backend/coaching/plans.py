"""Program templates and client plans (T2a).

A template is the coach's: his routines on weekdays, for a number of weeks (or open-ended).
Assigning it gives the client a plan version valid from a start date, with the client's OWN
copies of the routines, so the template can change later without touching anyone's plan.

A client plan is a history of versions. A change is a new version valid from today or later:
what already happened never changes (a started workout keeps its own snapshot of the plan).
A version for a date that already has one replaces it; the routine copies only that replaced
version used are archived (hidden from the client's list, kept for workouts that point at them).

What the coach prescribed is frozen on each day (`prescription`) when the version is made, apart
from the client's copy he trains with and may edit: the plan's history never changes.

Every request carries a client-made ID with a durable receipt per collaboration (PlanRequest),
kept apart from the versions: a delayed retry never runs again after its version was replaced,
and the same ID with different content is refused.
"""

import hashlib
import json

from datetime import timedelta

from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError

from training.models import Exercise, Routine, RoutineExercise, RoutineSet
from training.serializers import RoutineSerializer

from notifications.push import notify

from .models import ClientPlan, ClientPlanDay, ClientPlanVersion, CoachAssignment, PlanRequest

MAX_PLAN_DAYS_AHEAD = 366


class ClientExerciseMeasurementMismatch(ValidationError):
    """One client's edited copy cannot use the coach's original set prescription."""


class RequestConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = _('This request ID was already used for different content.')
    default_code = 'request_conflict'
PAST_VERSIONS_SHOWN = 5


def assignable_routine(coach, routine_id) -> Routine:
    """One of the coach's active routines that can be given to a client."""
    routine = Routine.objects.filter(pk=routine_id, owner=coach, archived_at__isnull=True).prefetch_related(
        'exercises__sets', 'exercises__exercise',
    ).first()
    if routine is None:
        raise ValidationError({'routine_id': _('Select one of your active workouts.')})
    rows = list(routine.exercises.all())
    if not rows:
        raise ValidationError({'routine_id': _('A workout must contain at least one exercise.')})
    # The coach's private exercises are fine: assigning copies them to the client (client_exercise).
    return routine


def coach_label(user) -> str:
    return (user.profile.display_name.strip() or user.email.split('@')[0])[:80]


def client_exercise(exercise: Exercise, client, coach) -> Exercise:
    """The exercise the client trains with: shared ones as they are, and for a coach's private one
    the client's own copy, labelled with the coach's name. One copy per coach exercise is reused on
    every later assignment; it stays the client's after the collaboration ends."""
    if exercise.owner_id is None or exercise.owner_id == client.pk:
        return exercise
    if exercise.owner_id != coach.pk:
        raise ValidationError({'routine': _('Invalid workout.')})
    copy = Exercise.objects.filter(owner=client, source_exercise=exercise).first()
    if copy is not None:
        # A client's edits are theirs, but the coach's prescribed set fields still use the
        # original measurement. Reusing a copy with another measurement would make a workout
        # that cannot be logged as prescribed; never silently overwrite the client's choice.
        if copy.measurement != exercise.measurement:
            raise ClientExerciseMeasurementMismatch({
                'routine': _('The client changed the measurement type for "%(name)s". Ask them to restore the original type before reassigning this workout.') % {'name': copy.name},
            })
        if copy.archived_at is not None:
            copy.archived_at = None
            copy.save(update_fields=['archived_at', 'search_name', 'updated_at'])
        return copy
    return Exercise.objects.create(
        owner=client, source_exercise=exercise, coach_name=coach_label(coach),
        name=exercise.name, aliases=exercise.aliases, equipment=exercise.equipment,
        measurement=exercise.measurement, load_mode=exercise.load_mode, muscle=exercise.muscle,
        instructions=exercise.instructions,
    )


def copy_routine(source: Routine, owner) -> Routine:
    """The client's own, independent copy of a coach's routine (private exercises copied too)."""
    clone = Routine.objects.create(owner=owner, name=source.name, notes=source.notes)
    copies = {}
    for item in source.exercises.all():
        if item.exercise_id not in copies:
            copies[item.exercise_id] = client_exercise(item.exercise, owner, source.owner)
        exercise = RoutineExercise.objects.create(
            routine=clone, exercise=copies[item.exercise_id], position=item.position,
            rest_seconds=item.rest_seconds, notes=item.notes,
        )
        RoutineSet.objects.bulk_create([
            RoutineSet(
                routine_exercise=exercise, position=s.position, set_type=s.set_type,
                reps_min=s.reps_min, reps_max=s.reps_max, weight_kg=s.weight_kg,
                duration_seconds=s.duration_seconds, distance_m=s.distance_m, rpe=s.rpe,
            ) for s in item.sets.all()
        ])
    return clone


def tailored_routine(request, payload, owner) -> Routine:
    """A routine adjusted for one client (weights, sets, reps), saved as his own."""
    if not isinstance(payload, dict):
        raise ValidationError({'routine': _('Invalid workout.')})
    body = {key: value for key, value in payload.items() if key not in ('id', 'revision', 'program_key')}
    # The client's own exercises are allowed too: a kept plan day already uses his copies.
    serializer = RoutineSerializer(data=body, context={'request': request, 'exercise_owner_id': owner.pk})
    serializer.is_valid(raise_exception=True)
    exercises = serializer.validated_data['exercises']
    if not exercises:
        raise ValidationError({'routine': _('A workout must contain at least one exercise.')})
    copies = {}
    for item in exercises:
        source = item['exercise']
        if source.pk not in copies:
            copies[source.pk] = client_exercise(source, owner, request.user)
        item['exercise'] = copies[source.pk]
    return serializer.save(owner=owner)


def check_valid_from(day):
    today = timezone.localdate()
    if day < today:
        raise ValidationError({'valid_from': _('A plan can change from today on; what already happened stays as it was.')})
    if day > today + timedelta(days=MAX_PLAN_DAYS_AHEAD):
        raise ValidationError({'valid_from': _('Choose a date within a year.')})


def version_end(version):
    """The first day the version no longer applies by its own length (None: open-ended)."""
    return version.valid_from + timedelta(weeks=version.weeks) if version.weeks else None


def version_on(versions, day):
    """The version in effect on `day` (versions sorted by valid_from), or None."""
    current = None
    for version in versions:
        if version.valid_from <= day:
            current = version
    if current is None:
        return None
    end = version_end(current)
    return None if end is not None and day >= end else current


def plan_routine_ids(plan) -> set:
    return set(ClientPlanDay.objects.filter(version__plan=plan).exclude(routine__isnull=True).values_list('routine_id', flat=True))


def save_version(connection, *, valid_from, weeks, name, reason, template, days):
    """Create a plan version. `days`: [(weekday, client routine, prescription)]. Call with the
    collaboration locked."""
    plan, _created = ClientPlan.objects.get_or_create(connection=connection)
    notify(connection.client, title='POMAK', body=_('Your coach updated your plan.'), url='/trener', tag=f'plan-{connection.id}')
    replaced = set()
    old = plan.versions.filter(valid_from=valid_from).first()
    if old is not None:
        replaced = set(old.days.exclude(routine__isnull=True).values_list('routine_id', flat=True))
        old.delete()
    version = ClientPlanVersion.objects.create(
        plan=plan, valid_from=valid_from, weeks=weeks, name=name, reason=reason,
        template=template,
    )
    ClientPlanDay.objects.bulk_create([
        ClientPlanDay(version=version, weekday=w, routine=r, prescription=p) for w, r, p in days
    ])
    # Copies only the replaced version used (not kept by the new one) leave the client's list.
    unused = replaced - plan_routine_ids(plan)
    Routine.objects.filter(pk__in=unused, archived_at__isnull=True).update(archived_at=timezone.now())
    return version


def payload_hash(data) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str, ensure_ascii=False).encode('utf-8')).hexdigest()


def prior_request(connection, request_id, operation, digest):
    """True if this exact request was already done for this collaboration; raises on reuse of the
    ID with different content. Call with the collaboration locked."""
    receipt = PlanRequest.objects.filter(connection=connection, request_id=request_id).first()
    if receipt is None:
        return False
    if receipt.operation != operation or receipt.payload_hash != digest:
        raise RequestConflict()
    return True


def record_request(connection, request_id, operation, digest):
    PlanRequest.objects.create(connection=connection, request_id=request_id, operation=operation, payload_hash=digest)


def kept_prescription(plan, routine_id):
    """What was prescribed for a routine already in the plan (its latest day), not its edited copy."""
    day = ClientPlanDay.objects.filter(version__plan=plan, routine_id=routine_id).order_by('-version__valid_from', '-version__created_at').first()
    return day.prescription if day else None


def attribute(connection, routine):
    """The client sees which routines his coach gave him."""
    CoachAssignment.objects.create(connection=connection, routine=routine)


def with_contents(routine) -> Routine:
    """The routine reloaded with its exercises and sets, e.g. a copy just written."""
    return Routine.objects.prefetch_related('exercises__exercise', 'exercises__sets').get(pk=routine.pk)


def prescription_of(routine) -> dict:
    """The routine as prescribed: name, exercises and planned sets (frozen on the plan day)."""
    return {
        'name': routine.name,
        'exercises': [
            {
                'exercise_id': str(item.exercise_id), 'name': item.exercise.name,
                'name_en': getattr(item.exercise, 'name_en', '') or '', 'measurement': item.exercise.measurement,
                'rest_seconds': item.rest_seconds, 'notes': item.notes,
                'sets': [
                    {'set_type': s.set_type, 'reps_min': s.reps_min, 'reps_max': s.reps_max,
                     'weight_kg': str(s.weight_kg) if s.weight_kg is not None else None,
                     'duration_seconds': s.duration_seconds, 'distance_m': s.distance_m,
                     'rpe': str(s.rpe) if s.rpe is not None else None}
                    for s in item.sets.all()
                ],
            }
            for item in routine.exercises.all()
        ],
    }


def _day_summary(day):
    """The prescription (history) and, if it still exists, the client's routine to train with."""
    if not day.prescription:
        return None
    usable = day.routine is not None and day.routine.archived_at is None
    return {**day.prescription, 'id': str(day.routine_id) if usable else None}


def plan_summary(plan, today=None):
    """Versions (recent past, current, upcoming) and today's planned routine."""
    today = today or timezone.localdate()
    versions = list(plan.versions.prefetch_related('days__routine').order_by('valid_from', 'created_at'))
    current = version_on(versions, today)
    past = [v for v in versions if v.valid_from <= today and v is not current]
    shown = past[-PAST_VERSIONS_SHOWN:] + [v for v in versions if v not in past]

    def state(version):
        if version is current:
            return 'current'
        return 'upcoming' if version.valid_from > today else 'past'

    def until(version):
        # Its own length, or the day before the next version starts, whichever is first.
        ends = [e for e in (version_end(version),) if e]
        later = [v.valid_from for v in versions if v.valid_from > version.valid_from]
        if later:
            ends.append(min(later))
        return min(ends) - timedelta(days=1) if ends else None

    def summary(version):
        return {
            'id': str(version.id), 'name': version.name, 'reason': version.reason,
            'valid_from': version.valid_from, 'valid_until': until(version),
            'weeks': version.weeks, 'template_id': str(version.template_id) if version.template_id else None,
            'created_at': version.created_at, 'state': state(version),
            'days': [{'weekday': d.weekday, 'routine': _day_summary(d)} for d in version.days.all()],
        }

    today_day = None
    if current is not None:
        day = next((d for d in current.days.all() if d.weekday == today.weekday()), None)
        today_day = {'weekday': today.weekday(), 'routine': _day_summary(day) if day else None}
    return {
        'id': str(plan.id),
        'today': today_day,
        'current_version_id': str(current.id) if current else None,
        'versions': [summary(v) for v in shown],
    }
