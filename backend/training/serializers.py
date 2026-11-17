import json
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from core.i18n import localized_name
from core.text import EXERCISE_PREMIGRATION_KEY_LIMIT, search_key_fits

from .models import Exercise, Routine, RoutineExercise, RoutineSet, SessionExercise, SetLog, WorkoutSession

MAX_EXERCISES_PER_ROUTINE = 40
MAX_SETS_PER_EXERCISE = 20
# Finished workouts use the same practical caps as the routine editor.
MAX_SESSION_EXERCISES = 40
MAX_SESSION_SETS_PER_EXERCISE = 20
MAX_WORKOUT_SNAPSHOT_BYTES = 256 * 1024


class ExerciseSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    is_custom = serializers.SerializerMethodField()

    class Meta:
        model = Exercise
        fields = [
            'id', 'slug', 'name', 'aliases', 'equipment', 'measurement', 'load_mode', 'muscle',
            'instructions', 'is_custom',
        ]
        read_only_fields = ['slug']

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
        fields = ['set_type', 'reps_min', 'reps_max', 'weight_kg', 'duration_seconds', 'distance_m']
        extra_kwargs = {
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
        fields = ['exercise', 'exercise_id', 'rest_seconds', 'notes', 'sets']
        extra_kwargs = {'rest_seconds': {'min_value': 0, 'max_value': 900}}

    def validate_exercise_id(self, exercise):
        user = self.context['request'].user
        if exercise.owner_id not in (None, user.pk):
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
    exercises = RoutineExerciseSerializer(many=True)

    class Meta:
        model = Routine
        fields = ['id', 'name', 'notes', 'exercises', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Enter the routine name.'))
        return value

    def validate_exercises(self, value):
        if len(value) > MAX_EXERCISES_PER_ROUTINE:
            raise serializers.ValidationError(
                _('At most %(count)d exercises per routine.') % {'count': MAX_EXERCISES_PER_ROUTINE}
            )
        return value

    @transaction.atomic
    def create(self, validated_data):
        exercises = validated_data.pop('exercises')
        routine = Routine.objects.create(**validated_data)
        self._write_exercises(routine, exercises)
        return routine

    @transaction.atomic
    def update(self, routine, validated_data):
        exercises = validated_data.pop('exercises', None)
        validated_data.pop('id', None)
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
        fields = ['set_type', 'weight_kg', 'reps', 'duration_seconds', 'distance_m', 'completed_at']
        extra_kwargs = {
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
        fields = ['exercise', 'exercise_id', 'notes', 'sets']

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


class WorkoutSessionSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    routine_id = serializers.PrimaryKeyRelatedField(
        queryset=Routine.objects.all(), source='routine', required=False, allow_null=True,
    )
    exercises = SessionExerciseSerializer(many=True)

    class Meta:
        model = WorkoutSession
        fields = [
            'id', 'routine_id', 'name', 'started_at', 'finished_at', 'plan_snapshot',
            'feeling', 'notes', 'exercises', 'created_at',
        ]
        read_only_fields = ['created_at']

    def validate_routine_id(self, routine):
        if routine is not None and routine.owner_id != self.context['request'].user.pk:
            raise serializers.ValidationError(_('This routine is not available.'))
        return routine

    def validate_exercises(self, value):
        if len(value) > MAX_SESSION_EXERCISES:
            raise serializers.ValidationError(
                _('At most %(count)d exercises per workout.') % {'count': MAX_SESSION_EXERCISES}
            )
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
        for item in exercises:
            sets = item.pop('sets')
            if not sets:
                continue  # vežba bez potvrđenih serija nije deo odrađenog treninga
            session_exercise = SessionExercise.objects.create(session=session, position=position, **item)
            position += 1
            logs += [SetLog(session_exercise=session_exercise, position=i, logged_by=user, **s) for i, s in enumerate(sets)]
        SetLog.objects.bulk_create(logs)
        return session
