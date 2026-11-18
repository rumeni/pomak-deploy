"""Reviewing a client's workouts, his statistics and a coach-set nutrition target (T2b).

Only for the coach of an active collaboration, and only what the client shares: readiness with
its own consent, the nutrition target only when the client let the coach guide nutrition.
"""

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.views import require_object_body
from nutrition.models import NutritionTarget
from training.models import Exercise, WorkoutSession
from training.stats import PERIODS, training_stats

from .models import CoachMessage, CoachTask, ExerciseInstruction
from .plan_views import active_connection_for
from notifications.push import notify

from .errors import workout_not_found
from .views import access_facts, instruction_summary, message_summary, readiness_summary


def _workout(connection, workout_id):
    workout = WorkoutSession.objects.filter(pk=workout_id, owner_id=connection.client_id).prefetch_related(
        'exercises__exercise', 'exercises__sets',
    ).first()
    if workout is None:
        raise workout_not_found()
    return workout


def _int(value, low=0, high=100_000):
    return value if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high else None


def _text(value, limit=100):
    return value[:limit] if isinstance(value, str) else None


def _decimal_text(value):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return str(value) if 0 <= number <= 100_000 else None


def clean_plan(snapshot):
    """The plan a workout started with, as the app sent it: keep only well-formed parts.

    Old or malformed snapshots ({"exercises": {}}, null entries, names that are objects...) must
    never break the review: a broken plan is simply unavailable, the done sets stay readable.
    """
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get('exercises'), list):
        return None
    exercises = []
    for item in snapshot['exercises'][:60]:
        if not isinstance(item, dict):
            continue
        exercise = item.get('exercise') if isinstance(item.get('exercise'), dict) else {}
        sets = []
        for s in item.get('sets') if isinstance(item.get('sets'), list) else []:
            if not isinstance(s, dict):
                continue
            sets.append({
                'set_type': 'warmup' if s.get('set_type') == 'warmup' else 'working',
                'reps_min': _int(s.get('reps_min')), 'reps_max': _int(s.get('reps_max')),
                'weight_kg': _decimal_text(s.get('weight_kg')), 'rpe': _decimal_text(s.get('rpe')),
                'duration_seconds': _int(s.get('duration_seconds'), high=86_400),
                'distance_m': _int(s.get('distance_m'), high=1_000_000),
            })
        exercises.append({'exercise': {'id': _text(exercise.get('id'), 40), 'name': _text(exercise.get('name'))}, 'sets': sets[:30]})
    return {'name': _text(snapshot.get('name')), 'exercises': exercises} if exercises else None


def _decimal(value):
    return str(value) if value is not None else None


class ClientWorkoutView(APIView):
    """One workout: what was planned (its own snapshot at the start) and what was done, the
    check-in (with readiness consent), whether it was reviewed, and the comments on it."""

    def get(self, request, client_id, workout_id):
        connection = active_connection_for(request, client_id)
        workout = _workout(connection, workout_id)
        task = CoachTask.objects.filter(
            connection=connection, kind=CoachTask.Kind.WORKOUT_REVIEW, key=str(workout.id),
        ).first()
        return Response({
            'access': access_facts(connection),
            # Only workouts finished during this collaboration are part of the review workflow.
            'reviewable': workout.finished_at >= connection.created_at,
            'id': str(workout.id), 'name': workout.name, 'started_at': workout.started_at,
            'finished_at': workout.finished_at, 'feeling': workout.feeling, 'notes': workout.notes,
            'edited_at': workout.edited_at,
            # Client data, sent by the app when the workout started; shown as text only.
            'plan': clean_plan(workout.plan_snapshot),
            'exercises': [
                {
                    'exercise_id': str(item.exercise_id), 'name': item.exercise.name,
                    'measurement': item.exercise.measurement, 'notes': item.notes,
                    'sets': [
                        {'set_type': s.set_type, 'reps': s.reps, 'weight_kg': _decimal(s.weight_kg),
                         'duration_seconds': s.duration_seconds, 'distance_m': s.distance_m, 'rpe': _decimal(s.rpe)}
                        for s in item.sets.all()
                    ],
                }
                for item in workout.exercises.all()
            ],
            'readiness': readiness_summary(workout) if connection.share_readiness else None,
            'reviewed_at': task.resolved_at if task and task.status == CoachTask.Status.DONE else None,
            'comments': [
                message_summary(m) for m in CoachMessage.objects.filter(connection=connection, workout=workout)
                .select_related('workout').order_by('created_at', 'id')[:200]
            ],
        })


class WorkoutReviewedView(APIView):
    """Mark a workout as reviewed: its review task is done (made if the sync had not yet)."""

    @transaction.atomic
    def post(self, request, client_id, workout_id):
        body = BoundSerializer(data=require_object_body(request))
        body.is_valid(raise_exception=True)
        connection = active_connection_for(request, client_id, lock=True, expected=body.validated_data['connection_id'])
        workout = _workout(connection, workout_id)
        if workout.finished_at < connection.created_at:
            raise ValidationError({'detail': _('Only workouts from this collaboration can be marked as reviewed.')})
        now = timezone.now()
        task, _created = CoachTask.objects.get_or_create(
            connection=connection, kind=CoachTask.Kind.WORKOUT_REVIEW, key=str(workout.id),
            defaults={'event_at': workout.finished_at or workout.started_at,
                      'data': {'workout_id': str(workout.id), 'workout': workout.name}},
        )
        task.status, task.resolved_at, task.snoozed_until, task.auto_resolved = CoachTask.Status.DONE, now, None, False
        task.save(update_fields=['status', 'resolved_at', 'snoozed_until', 'auto_resolved', 'updated_at'])
        return Response({'reviewed_at': now})


class ClientStatsView(APIView):
    """The client's training statistics, as the client sees them, minus what he does not share."""

    def get(self, request, client_id):
        connection = active_connection_for(request, client_id)
        period = request.query_params.get('period', '30')
        if period not in PERIODS:
            raise ValidationError({'period': _('Choose one of the offered periods.')})
        stats = training_stats(connection.client, period)
        if not connection.share_readiness:
            stats['readiness'] = []
        return Response({**stats, 'access': access_facts(connection)})


class BoundSerializer(serializers.Serializer):
    """A write names the collaboration it is meant for."""

    connection_id = serializers.UUIDField()


class CoachTargetSerializer(BoundSerializer):
    valid_from = serializers.DateField()
    kcal = serializers.IntegerField(min_value=800, max_value=8000)
    protein_g = serializers.IntegerField(min_value=0, max_value=600, required=False, allow_null=True, default=None)
    carbs_g = serializers.IntegerField(min_value=0, max_value=1500, required=False, allow_null=True, default=None)
    fat_g = serializers.IntegerField(min_value=0, max_value=500, required=False, allow_null=True, default=None)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default='')

    def validate_valid_from(self, value):
        today = timezone.localdate()
        if value < today:
            raise serializers.ValidationError(_('A new target applies from today on; earlier days keep theirs.'))
        if (value - today).days > 366:
            raise serializers.ValidationError(_('Choose a date within a year.'))
        return value

    def validate(self, attrs):
        macro_kcal = 4 * (attrs['protein_g'] or 0) + 4 * (attrs['carbs_g'] or 0) + 9 * (attrs['fat_g'] or 0)
        if macro_kcal > attrs['kcal'] * 1.1:
            raise serializers.ValidationError({'kcal': _('The macros add up to more calories than the target.')})
        return attrs


def target_summary(target):
    if target is None:
        return None
    return {
        'valid_from': target.valid_from, 'mode': target.mode, 'kcal': target.kcal, 'protein_g': target.protein_g,
        'carbs_g': target.carbs_g, 'fat_g': target.fat_g, 'set_by_coach': target.mode == NutritionTarget.Mode.COACH,
        'note': (target.explanation or {}).get('coach_note', '') if isinstance(target.explanation, dict) else '',
    }


def client_targets(connection):
    """Today's target and the next planned one, for a coach who may see them."""
    today = timezone.localdate()
    return {
        'current': target_summary(NutritionTarget.for_date(connection.client, today)),
        'next': target_summary(NutritionTarget.objects.filter(owner=connection.client, valid_from__gt=today).order_by('valid_from').first()),
    }


class ClientNutritionTargetView(APIView):
    def get(self, request, client_id):
        connection = active_connection_for(request, client_id)
        if not (connection.coach_sets_nutrition or connection.share_nutrition):
            return Response({'allowed': False, 'can_set': False, 'current': None, 'next': None, 'access': access_facts(connection)})
        return Response({'allowed': True, 'can_set': connection.coach_sets_nutrition, **client_targets(connection),
                         'access': access_facts(connection)})

    @transaction.atomic
    def post(self, request, client_id):
        require_object_body(request)
        serializer = CoachTargetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        connection = active_connection_for(request, client_id, lock=True, expected=serializer.validated_data['connection_id'])
        if not connection.coach_sets_nutrition:
            raise ValidationError({'detail': _('The client has not let you set the nutrition target.')})
        data = serializer.validated_data
        values = {
            'mode': NutritionTarget.Mode.COACH, 'kcal': data['kcal'], 'protein_g': data['protein_g'],
            'carbs_g': data['carbs_g'], 'fat_g': data['fat_g'], 'method': '', 'inputs': None,
            'explanation': {'coach_note': data['note']} if data['note'] else None, 'set_by': request.user,
        }
        # One target per date (as everywhere): a target for that date is replaced; earlier days keep theirs.
        try:
            with transaction.atomic():
                NutritionTarget.objects.update_or_create(owner=connection.client, valid_from=data['valid_from'], defaults=values)
        except IntegrityError:
            NutritionTarget.objects.filter(owner=connection.client, valid_from=data['valid_from']).update(**values)
        return Response({'allowed': True, 'can_set': True, **client_targets(connection), 'access': access_facts(connection)},
                        status=status.HTTP_201_CREATED)


class ClientWeekView(APIView):
    """A client's week in review, with only what he shares; his check-in is written for the coach."""

    def get(self, request, client_id, day):
        from progress.views import week_monday
        from progress.weekly import week_review

        connection = active_connection_for(request, client_id)
        review = week_review(
            connection.client, week_monday(day), measurements=connection.share_measurements,
            nutrition=connection.share_nutrition, readiness=connection.share_readiness, coach_connection=connection,
        )
        return Response({**review, 'access': access_facts(connection)})


class InstructionSerializer(BoundSerializer):
    exercise_id = serializers.UUIDField()
    # Empty: remove the instruction.
    text = serializers.CharField(max_length=500, allow_blank=True, trim_whitespace=True)


class ClientInstructionsView(APIView):
    """The coach's standing instructions for this client's exercises."""

    def get(self, request, client_id):
        connection = active_connection_for(request, client_id)
        return Response(self.listing(connection))

    @transaction.atomic
    def put(self, request, client_id):
        serializer = InstructionSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        connection = active_connection_for(request, client_id, lock=True, expected=data['connection_id'])
        # A library exercise, or the client's own; never another person's.
        exercise = Exercise.objects.filter(Q(owner__isnull=True) | Q(owner_id=connection.client_id), pk=data['exercise_id']).first()
        if exercise is None:
            raise ValidationError({'exercise_id': _('That exercise is not available to this client.')})
        if data['text']:
            ExerciseInstruction.objects.update_or_create(connection=connection, exercise=exercise, defaults={'text': data['text']})
            notify(connection.client, title='POMAK', tag=f'instruction-{connection.id}', url='/trening',
                   body=_('Your coach added a new exercise instruction.'))
        else:
            ExerciseInstruction.objects.filter(connection=connection, exercise=exercise).delete()
        return Response(self.listing(connection))

    @staticmethod
    def listing(connection):
        rows = ExerciseInstruction.objects.filter(connection=connection).select_related('exercise')
        return {'access': access_facts(connection), 'results': [instruction_summary(x) for x in rows]}

