import json
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from core.i18n import localized_name
from core.views import AlreadySavedConflict, _matches_saved_payload
from core.text import EXERCISE_PREMIGRATION_KEY_LIMIT, search_key_fits

from .models import READINESS_FIELDS, Exercise, Routine, RoutineExercise, RoutineSet, SessionExercise, SetLog, WorkoutSession

MAX_EXERCISES_PER_ROUTINE = 40
MAX_SETS_PER_EXERCISE = 20
# Finished workouts use the same practical caps as the routine editor.
MAX_SESSION_EXERCISES = 40
MAX_SESSION_SETS_PER_EXERCISE = 20
MAX_WORKOUT_SNAPSHOT_BYTES = 256 * 1024
# A superset is two exercises, a tri-set three.
MAX_SUPERSET_SIZE = 3
SUPERSET_KWARGS = {'required': False, 'allow_null': True, 'min_value': 1, 'max_value': 1000}


def validate_rpe(value):
    """RPE goes in half steps (7, 7.5, 8 ...), the same scale the app offers."""
    if value is not None and (value * 2) % 1:
        raise serializers.ValidationError(_('RPE goes in steps of 0.5.'))
    return value


RPE_KWARGS = {'min_value': Decimal('1'), 'max_value': Decimal('10'), 'validators': [validate_rpe]}


def check_supersets(items):
    """Exercises of one superset must be next to each other, at most MAX_SUPERSET_SIZE of them."""
    seen, previous, size = set(), None, 0
    for item in items:
        number = item.get('superset')
        if number is not None and number == previous:
            size += 1
        elif number is not None:
            if number in seen:
                raise serializers.ValidationError(_('Exercises of a superset must be next to each other.'))
            seen.add(number)
            size = 1
        if size > MAX_SUPERSET_SIZE:
            raise serializers.ValidationError(
                _('A superset has at most %(count)d exercises.') % {'count': MAX_SUPERSET_SIZE}
            )
        previous = number


def number_supersets(items):
    """Renumbers supersets 1, 2 ... in order; a number left on a single exercise is cleared.

    Expects items that passed check_supersets (members next to each other).
    """
    runs = []
    for index, item in enumerate(items):
        number = item.get('superset')
        if number is not None and runs and runs[-1][0] == number and runs[-1][2] == index - 1:
            runs[-1][2] = index
        else:
            runs.append([number, index, index])
    count = 0
    for number, start, end in runs:
        together = number is not None and end > start
        if together:
            count += 1
        for index in range(start, end + 1):
            items[index]['superset'] = count if together else None
    return items


class ExerciseSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    is_custom = serializers.SerializerMethodField()

    class Meta:
        model = Exercise
        fields = [
            'id', 'slug', 'name', 'aliases', 'equipment', 'measurement', 'load_mode', 'unilateral', 'muscle',
            'instructions', 'is_custom', 'coach_name',
        ]
        # coach_name: set only when a coach's private exercise is copied to this client.
        read_only_fields = ['slug', 'coach_name']

    def get_is_custom(self, obj) -> bool:
        return obj.owner_id is not None

    def to_representation(self, obj):
        data = super().to_representation(obj)
        # Zajednička biblioteka ima i engleski naziv; lična vežba ostaje kako ju je korisnik nazvao.
        data['name'] = localized_name(obj)
        data['instructions'] = localized_name(obj, 'instructions')
        return data

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Enter the exercise name.'))
        return value

    def update(self, instance, validated_data):
        validated_data.pop('id', None)  # Never re-key an existing exercise.
        return super().update(instance, validated_data)

    def validate(self, attrs):
        name = attrs.get('name', getattr(self.instance, 'name', ''))
        aliases = attrs.get('aliases', getattr(self.instance, 'aliases', ''))
        if not search_key_fits(name, getattr(self.instance, 'name_en', ''),
                               aliases, max_chars=EXERCISE_PREMIGRATION_KEY_LIMIT):
            raise serializers.ValidationError({'name': _('Name or aliases are too long for search.')})
        return attrs


class RoutineSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoutineSet
        fields = ['set_type', 'reps_min', 'reps_max', 'weight_kg', 'duration_seconds', 'distance_m', 'rpe']
        extra_kwargs = {
            'rpe': RPE_KWARGS,
            'reps_min': {'min_value': 1, 'max_value': 1000},
            'reps_max': {'min_value': 1, 'max_value': 1000},
            'weight_kg': {'min_value': 0, 'max_value': 1000},
            'duration_seconds': {'min_value': 1, 'max_value': 24 * 3600},
            'distance_m': {'min_value': 1, 'max_value': 500_000},
        }

    def validate(self, attrs):
        low, high = attrs.get('reps_min'), attrs.get('reps_max')
        if low is not None and high is not None and low > high:
            raise serializers.ValidationError({'reps_max': _('The upper rep limit is lower than the lower one.')})
        return attrs


class RoutineExerciseSerializer(serializers.ModelSerializer):
    exercise = ExerciseSerializer(read_only=True)
    exercise_id = serializers.PrimaryKeyRelatedField(queryset=Exercise.objects.all(), write_only=True, source='exercise')
    sets = RoutineSetSerializer(many=True)

    class Meta:
        model = RoutineExercise
        fields = ['exercise', 'exercise_id', 'rest_seconds', 'notes', 'superset', 'sets']
        extra_kwargs = {'rest_seconds': {'min_value': 0, 'max_value': 900}, 'superset': SUPERSET_KWARGS}

    def validate_exercise_id(self, exercise):
        user = self.context['request'].user
        # A coach tailoring a client's plan may also use the client's own exercises (e.g. copies of
        # the coach's private ones); the owner of the routine being built is passed in the context.
        if exercise.owner_id not in (None, user.pk, self.context.get('exercise_owner_id')):
            raise serializers.ValidationError(_('This exercise is not available.'))
        return exercise

    def validate_sets(self, value):
        if not value:
            raise serializers.ValidationError(_('An exercise needs at least one set.'))
        if len(value) > MAX_SETS_PER_EXERCISE:
            raise serializers.ValidationError(
                _('At most %(count)d sets per exercise.') % {'count': MAX_SETS_PER_EXERCISE}
            )
        return value


class RoutineSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    revision = serializers.DateTimeField(required=False, write_only=True)
    exercises = RoutineExerciseSerializer(many=True)

    class Meta:
        model = Routine
        fields = ['id', 'name', 'notes', 'program_key', 'revision', 'exercises', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Enter the workout name.'))
        return value

    def validate_exercises(self, value):
        if len(value) > MAX_EXERCISES_PER_ROUTINE:
            raise serializers.ValidationError(
                _('At most %(count)d exercises per workout.') % {'count': MAX_EXERCISES_PER_ROUTINE}
            )
        check_supersets(value)
        return number_supersets(value)

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop('revision', None)
        exercises = validated_data.pop('exercises')
        routine = Routine.objects.create(**validated_data)
        self._write_exercises(routine, exercises)
        return routine

    @transaction.atomic
    def update(self, routine, validated_data):
        revision = validated_data.pop('revision', None)
        if revision is not None and revision != routine.updated_at:
            # A lost PUT response may be retried with the original revision.
            # Identical content is a read-only success, not a false conflict.
            incoming = {key: value for key, value in self.initial_data.items()
                        if key not in ('id', 'revision')}
            if _matches_saved_payload(incoming, self.to_representation(routine)):
                return routine
            raise AlreadySavedConflict()
        exercises = validated_data.pop('exercises', None)
        validated_data.pop('id', None)
        validated_data.pop('program_key', None)  # Provenance cannot change when editing a routine.
        for field, value in validated_data.items():
            setattr(routine, field, value)
        routine.save()
        if exercises is not None:
            # Rutina je šablon: završeni treninzi čuvaju svoj snimak plana, pa sadržaj
            # rutine može da se zameni u celosti.
            routine.exercises.all().delete()
            self._write_exercises(routine, exercises)
        return routine

    def _write_exercises(self, routine, exercises):
        sets_to_create = []
        for position, item in enumerate(exercises):
            sets = item.pop('sets')
            routine_exercise = RoutineExercise.objects.create(routine=routine, position=position, **item)
            sets_to_create += [
                RoutineSet(routine_exercise=routine_exercise, position=i, **s) for i, s in enumerate(sets)
            ]
        RoutineSet.objects.bulk_create(sets_to_create)


MAX_WORKOUT_HOURS = 24


class SetLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SetLog
        fields = ['set_type', 'weight_kg', 'reps', 'duration_seconds', 'distance_m', 'completed_at', 'rpe']
        extra_kwargs = {
            'rpe': RPE_KWARGS,
            'reps': {'min_value': 0, 'max_value': 1000},
            'weight_kg': {'min_value': 0, 'max_value': 1000},
            'duration_seconds': {'min_value': 1, 'max_value': 24 * 3600},
            'distance_m': {'min_value': 1, 'max_value': 500_000},
        }

    def validate(self, attrs):
        if all(attrs.get(f) is None for f in ('weight_kg', 'reps', 'duration_seconds', 'distance_m')):
            raise serializers.ValidationError(_('A confirmed set needs at least one value.'))
        return attrs


class SessionExerciseSerializer(serializers.ModelSerializer):
    exercise = ExerciseSerializer(read_only=True)
    exercise_id = serializers.PrimaryKeyRelatedField(queryset=Exercise.objects.all(), write_only=True, source='exercise')
    sets = SetLogSerializer(many=True)

    class Meta:
        model = SessionExercise
        fields = ['exercise', 'exercise_id', 'notes', 'superset', 'sets']
        # Older app versions do not send it.
        extra_kwargs = {'superset': SUPERSET_KWARGS}

    def validate_sets(self, value):
        if len(value) > MAX_SESSION_SETS_PER_EXERCISE:
            raise serializers.ValidationError(
                _('At most %(count)d sets per exercise.') % {'count': MAX_SESSION_SETS_PER_EXERCISE}
            )
        return value

    def validate_exercise_id(self, exercise):
        if exercise.owner_id not in (None, self.context['request'].user.pk):
            raise serializers.ValidationError(_('This exercise is not available.'))
        return exercise


class ReadinessSerializer(serializers.ModelSerializer):
    """Pre-workout check-in, stored on the session itself and nested in the API."""

    class Meta:
        model = WorkoutSession
        fields = list(READINESS_FIELDS)
        extra_kwargs = {
            'sleep_hours': {'min_value': 0, 'max_value': 14},
            **{f: {'min_value': 1, 'max_value': 5} for f in READINESS_FIELDS if f != 'sleep_hours'},
        }


class WorkoutSessionSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    # Optional: older app versions do not send it.
    readiness = ReadinessSerializer(source='*', required=False)
    routine_id = serializers.PrimaryKeyRelatedField(
        queryset=Routine.objects.all(), source='routine', required=False, allow_null=True,
    )
    exercises = SessionExerciseSerializer(many=True)

    class Meta:
        model = WorkoutSession
        fields = [
            'id', 'routine_id', 'name', 'started_at', 'finished_at', 'plan_snapshot',
            'feeling', 'notes', 'readiness', 'exercises', 'created_at', 'updated_at', 'edited_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'edited_at']

    def validate_routine_id(self, routine):
        if routine is not None and routine.owner_id != self.context['request'].user.pk:
            raise serializers.ValidationError(_('This workout is not available.'))
        return routine

    def validate_exercises(self, value):
        if len(value) > MAX_SESSION_EXERCISES:
            raise serializers.ValidationError(
                _('At most %(count)d exercises per workout.') % {'count': MAX_SESSION_EXERCISES}
            )
        check_supersets(value)
        return value

    def validate_plan_snapshot(self, value):
        if value is None:
            return value
        try:
            size = len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        except (TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
            raise serializers.ValidationError(_('Invalid workout plan snapshot.')) from None
        if size > MAX_WORKOUT_SNAPSHOT_BYTES:
            raise serializers.ValidationError(_('The workout plan snapshot is too large.'))
        return value

    def validate(self, attrs):
        started, finished = attrs['started_at'], attrs['finished_at']
        if finished < started:
            raise serializers.ValidationError({'finished_at': _('The workout cannot end before it started.')})
        if finished - started > timedelta(hours=MAX_WORKOUT_HOURS):
            raise serializers.ValidationError({'finished_at': _('A workout cannot last longer than 24 hours.')})
        if started > timezone.now() + timedelta(minutes=5):
            raise serializers.ValidationError({'started_at': _('The workout cannot start in the future.')})
        if not any(item['sets'] for item in attrs['exercises']):
            raise serializers.ValidationError(_('The workout has no confirmed sets.'))
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        exercises = validated_data.pop('exercises')
        user = self.context['request'].user
        session = WorkoutSession.objects.create(**validated_data)
        logs = []
        position = 0
        # Vežba bez potvrđenih serija nije deo odrađenog treninga; superset bez nje može da ostane
        # sa jednom vežbom, pa se brojevi računaju tek za ono što se čuva.
        for item in number_supersets([item for item in exercises if item['sets']]):
            sets = item.pop('sets')
            session_exercise = SessionExercise.objects.create(session=session, position=position, **item)
            position += 1
            logs += [SetLog(session_exercise=session_exercise, position=i, logged_by=user, **s) for i, s in enumerate(sets)]
        SetLog.objects.bulk_create(logs)
        return session


class SessionExerciseEditSerializer(serializers.Serializer):
    """One exercise of a finished workout being corrected; matched to the saved one by position."""

    exercise_id = serializers.UUIDField()
    notes = serializers.CharField(max_length=300, allow_blank=True, required=False, default='')
    sets = SetLogSerializer(many=True)

    def validate_sets(self, value):
        if not value:
            raise serializers.ValidationError(_('An exercise needs at least one set.'))
        if len(value) > MAX_SESSION_SETS_PER_EXERCISE:
            raise serializers.ValidationError(
                _('At most %(count)d sets per exercise.') % {'count': MAX_SESSION_SETS_PER_EXERCISE}
            )
        return value


class WorkoutSessionEditSerializer(serializers.ModelSerializer):
    """Correcting a finished workout: values of its sets, notes, feeling and the check-in.

    The exercises and times stay as they were done: exercises are matched by position and
    must be the same ones. `revision` is the `updated_at` the client loaded; the view refuses
    the edit if the workout changed since (another device), instead of overwriting it.
    """

    revision = serializers.DateTimeField(write_only=True)
    readiness = ReadinessSerializer(source='*', required=False)
    exercises = SessionExerciseEditSerializer(many=True)

    class Meta:
        model = WorkoutSession
        fields = ['revision', 'name', 'feeling', 'notes', 'readiness', 'exercises']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Enter the workout name.'))
        return value

    def validate_exercises(self, value):
        saved = list(self.instance.exercises.order_by('position').values_list('exercise_id', flat=True))
        if [item['exercise_id'] for item in value] != saved:
            raise serializers.ValidationError(_('The exercises of a finished workout cannot be changed.'))
        return value

    SET_FIELDS = ('set_type', 'weight_kg', 'reps', 'duration_seconds', 'distance_m', 'rpe', 'completed_at')

    def matches_saved(self, session) -> bool:
        """Would this edit leave the workout exactly as it is now (e.g. a retried request)?

        Compares the complete state the PUT would write - an omitted optional set field means
        "empty", an omitted session field means "unchanged" - with what is saved, so a stale
        edit that clears a value the other device has set is a conflict, not a match.
        """
        data = self.validated_data
        defaults = {'set_type': SetLog._meta.get_field('set_type').default}
        for field in ('name', 'feeling', 'notes', *READINESS_FIELDS):
            if field in data and data[field] != getattr(session, field):
                return False
        saved = list(session.exercises.order_by('position').prefetch_related('sets'))
        for session_exercise, item in zip(saved, data['exercises'], strict=True):
            if item.get('notes', '') != session_exercise.notes:
                return False
            current = [{f: getattr(s, f) for f in self.SET_FIELDS} for s in session_exercise.sets.order_by('position')]
            wanted = [{f: values.get(f, defaults.get(f)) for f in self.SET_FIELDS} for values in item['sets']]
            if current != wanted:
                return False
        return True

    @transaction.atomic
    def update(self, session, validated_data):
        validated_data.pop('revision', None)
        exercises = validated_data.pop('exercises')
        for field, value in validated_data.items():
            setattr(session, field, value)
        session.edited_at = timezone.now()
        session.save()
        user = self.context['request'].user
        logs = []
        for session_exercise, item in zip(session.exercises.order_by('position'), exercises, strict=True):
            session_exercise.notes = item.get('notes', '')
            session_exercise.save(update_fields=['notes', 'updated_at'])
            session_exercise.sets.all().delete()
            # The client sends each set's original `completed_at` back (null for a set added during
            # the correction), so removing a set never shifts the others' times.
            logs += [
                SetLog(session_exercise=session_exercise, position=i, logged_by=user, **values)
                for i, values in enumerate(item['sets'])
            ]
        SetLog.objects.bulk_create(logs)
        return session



class ScheduleDaySerializer(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    routine_id = serializers.PrimaryKeyRelatedField(queryset=Routine.objects.all())

    def validate_routine_id(self, routine):
        if routine.owner_id != self.context['request'].user.pk or routine.archived_at is not None:
            raise serializers.ValidationError(_('This workout is not available.'))
        return routine


class ScheduleSerializer(serializers.Serializer):
    """The whole week at once; days that are not listed are rest days."""

    days = ScheduleDaySerializer(many=True, max_length=7)

    def validate_days(self, value):
        weekdays = [day['weekday'] for day in value]
        if len(weekdays) != len(set(weekdays)):
            raise serializers.ValidationError(_('One workout per day.'))
        return value
