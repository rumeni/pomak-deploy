from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Max, Prefetch, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import get_language
from django.utils.translation import gettext_lazy as _
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.search import search_and_order
from core.views import IdempotentCreateMixin, SharedLibraryMixin, require_object_body

from . import programs, progress, stats
from .models import Exercise, Routine, RoutineExercise, ScheduleDay, SessionExercise, WorkoutSession
from .serializers import (
    ExerciseSerializer, RoutineSerializer, ScheduleSerializer, SetLogSerializer, WorkoutSessionEditSerializer,
    WorkoutSessionSerializer,
)

MAX_PREVIOUS_LOOKUP = 50


class ExerciseViewSet(
    IdempotentCreateMixin, SharedLibraryMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    """Zajednička biblioteka + lične vežbe. Pretraga radi i bez kvačica (?q=cucanj)."""

    serializer_class = ExerciseSerializer
    owner_field = 'owner'
    retry_action = 'update'
    shared_readonly_message = _('Exercises from the shared library cannot be changed.')
    http_method_names = ['get', 'post', 'patch', 'delete']

    def get_queryset(self):
        qs = Exercise.visible_to(self.request.user).filter(archived_at__isnull=True)
        params = self.request.query_params
        if muscle := params.get('muscle'):
            qs = qs.filter(muscle=muscle)
        if equipment := params.get('equipment'):
            qs = qs.filter(equipment=equipment)
        return search_and_order(qs, params.get('q', ''))


class RoutineViewSet(IdempotentCreateMixin, viewsets.ModelViewSet):
    serializer_class = RoutineSerializer
    owner_field = 'owner'
    retry_action = 'update'
    http_method_names = ['get', 'post', 'put', 'delete']

    def get_queryset(self):
        qs = Routine.objects.filter(owner=self.request.user, archived_at__isnull=True)
        if self.action == 'update':
            qs = qs.select_for_update()
        return (
            qs
            .prefetch_related(
                Prefetch('exercises', queryset=RoutineExercise.objects.select_related('exercise').prefetch_related('sets')),
            )
        )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        # Lock before comparing the submitted revision and replacing all sets.
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_destroy(self, routine):
        routine.archived_at = timezone.now()
        routine.save(update_fields=['archived_at', 'updated_at'])

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        source = self.get_serializer(self.get_object()).data
        payload = {
            'name': (_('%(name)s (copy)') % {'name': source['name']})[:100],
            'notes': source['notes'],
            'exercises': [
                {**item, 'exercise_id': item['exercise']['id']} for item in source['exercises']
            ],
        }
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        serializer.save(owner=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class WorkoutSessionViewSet(
    IdempotentCreateMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
    mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    """Odrađeni treninzi. Klijent šalje ceo trening jednom, na kraju, sa svojim ID-jem.

    PUT corrects a finished workout (set values, notes, feeling, check-in); see `update`.
    """

    serializer_class = WorkoutSessionSerializer
    owner_field = 'owner'
    HISTORY_LIMIT = 50
    http_method_names = ['get', 'post', 'put', 'delete', 'head', 'options']

    def update(self, request, *args, **kwargs):
        """Correct a finished workout, guarded by `revision` (the `updated_at` the client loaded).

        If the workout changed since, the edit is applied only when it is identical to what is
        saved (a retry after a lost response returns 200); otherwise 409 with the current
        workout, so a correction from one device never silently overwrites another.
        """
        body = require_object_body(request)
        with transaction.atomic():
            session = self.get_queryset().select_for_update(of=('self',)).filter(pk=kwargs['pk']).first()
            if session is None:
                raise NotFound()
            serializer = WorkoutSessionEditSerializer(session, data=body, context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            if serializer.validated_data['revision'] != session.updated_at:
                current = self.get_serializer(session).data
                if serializer.matches_saved(session):
                    return Response(current)
                return Response(
                    {'detail': _('This workout was changed elsewhere. Reload it and edit again.'), 'current': current},
                    status=status.HTTP_409_CONFLICT,
                )
            serializer.save()
        session = self.get_queryset().get(pk=session.pk)
        return Response(self.get_serializer(session).data)

    def get_queryset(self):
        return WorkoutSession.objects.filter(owner=self.request.user).prefetch_related(
            Prefetch('exercises', queryset=SessionExercise.objects.select_related('exercise').prefetch_related('sets')),
        )

    def list(self, request, *args, **kwargs):
        # Cursor pagination, but retain the original array response for old
        # Android/PWA clients. New clients pass the last received timestamp and
        # UUID; new workouts cannot shift subsequent pages or cause duplicates.
        queryset = self.get_queryset().order_by('-started_at', '-pk')
        params = request.query_params
        if 'before' in params or 'before_id' in params:
            raw_date, raw_id = params.get('before', ''), params.get('before_id', '')
            try:
                before = parse_datetime(raw_date) if len(raw_date) <= 64 else None
                before_id = UUID(raw_id)
            except (ValueError, TypeError, AttributeError):
                before, before_id = None, None
            if before is None or before_id is None or timezone.is_naive(before):
                raise ValidationError({'before': _('Invalid history cursor.')})
            queryset = queryset.filter(
                Q(started_at__lt=before) | Q(started_at=before, pk__lt=before_id)
            )
        sessions = queryset[: self.HISTORY_LIMIT]
        return Response(self.get_serializer(sessions, many=True).data)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @action(detail=False, methods=['get'])
    def previous(self, request):
        """Poslednji rezultat za svaku traženu vežbu: ?exercise_ids=a,b,c"""
        ids = [i for i in request.query_params.get('exercise_ids', '').split(',') if i][:MAX_PREVIOUS_LOOKUP]
        result = {}
        for exercise_id in ids:
            try:
                last = (
                    SessionExercise.objects.filter(session__owner=request.user, exercise_id=exercise_id)
                    .select_related('session')
                    .prefetch_related('sets')
                    .order_by('-session__started_at')
                    .first()
                )
            except (ValueError, DjangoValidationError):
                continue
            if last:
                result[exercise_id] = {
                    'session_id': str(last.session_id),
                    'started_at': last.session.started_at,
                    'sets': SetLogSerializer(last.sets.all(), many=True).data,
                }
        return Response(result)


class ProgramsView(APIView):
    """Suggested programs (see programs.py); the ones matching the profile come first."""

    def get(self, request):
        lang = 'en' if get_language() == 'en' else 'sr'
        profile = getattr(request.user, 'profile', None)
        sex = getattr(profile, 'sex', None) or 'male'  # no answer: the general programs
        level = getattr(profile, 'training_experience', None) or programs.B
        exercises = {e.slug: e for e in Exercise.objects.filter(owner__isnull=True, slug__in={
            item['slug'] for p in programs.PROGRAMS for r in p['routines'] for item in r['exercises']
        })}
        result = []
        for p in programs.PROGRAMS:
            routines = []
            for routine in p['routines']:
                items = []
                for item in routine['exercises']:
                    exercise = exercises.get(item['slug'])
                    if exercise is None:
                        continue  # library not migrated yet; skip rather than fail
                    timed = exercise.measurement == Exercise.Measurement.DURATION
                    items.append({
                        'exercise': ExerciseSerializer(exercise).data,
                        'rest_seconds': item['rest_seconds'],
                        'notes': '',
                        'sets': [{
                            'set_type': 'working',
                            'reps_min': None if timed else item['reps_min'],
                            'reps_max': None if timed else item['reps_max'],
                            'weight_kg': None,
                            'duration_seconds': item['reps_max'] if timed else None,
                            'distance_m': None,
                            'rpe': None if item['rpe'] is None else str(item['rpe']),
                        }] * item['sets'],
                    })
                routines.append({'name': routine['name'][lang], 'exercises': items})
            result.append({
                'key': p['key'], 'sex': p['sex'], 'level': p['level'], 'days': p['days'],
                'name': p['name'][lang], 'description': p['description'][lang], 'routines': routines,
                'recommended': p['sex'] == sex and p['level'] == level,
            })
        result.sort(key=lambda p: (not p['recommended'], p['sex'] != sex, programs.LEVEL_ORDER[p['level']]))
        return Response(result)


class StatsView(APIView):
    """Training statistics and readiness history for ?period=7|30|90|all (see stats.py)."""

    def get(self, request):
        period = request.query_params.get('period', '30')
        if period not in stats.PERIODS:
            raise ValidationError({'period': _('Choose 7, 30 or 90 days, or all.')})
        return Response(stats.training_stats(request.user, period))


class PerformedExercisesView(APIView):
    """Vežbe koje je korisnik radio, poslednja urađena prva (ulaz u napredak po vežbi)."""

    def get(self, request):
        rows = (
            SessionExercise.objects.filter(session__owner=request.user)
            .values('exercise_id')
            .annotate(last_performed=Max('session__started_at'), sessions=Count('session', distinct=True))
            .order_by('-last_performed')
        )
        exercises = {e.id: e for e in Exercise.objects.filter(pk__in=[r['exercise_id'] for r in rows])}
        return Response([
            {
                'exercise': ExerciseSerializer(exercises[r['exercise_id']]).data,
                'last_performed': r['last_performed'],
                'sessions': r['sessions'],
            }
            for r in rows
        ])


class ExerciseProgressView(APIView):
    """Rekordi, grafikon i istorija jedne vežbe."""

    HISTORY_LIMIT = 30

    def get(self, request, exercise_id):
        exercise = Exercise.visible_to(request.user).filter(pk=exercise_id).first()
        if exercise is None:
            raise NotFound()
        done = list(
            SessionExercise.objects.filter(session__owner=request.user, exercise=exercise)
            .select_related('session')
            .prefetch_related('sets')
            .order_by('session__started_at')
        )
        result = progress.analyze(exercise.measurement, done, load_mode=exercise.load_mode, unilateral=exercise.unilateral)
        return Response({
            'exercise': ExerciseSerializer(exercise).data,
            **result,
            'history': [
                {
                    'session_id': se.session_id,
                    'name': se.session.name,
                    'started_at': se.session.started_at,
                    'sets': SetLogSerializer(se.sets.all(), many=True).data,
                }
                for se in reversed(done[-self.HISTORY_LIMIT:])
            ],
        })


class ScheduleView(APIView):
    """The athlete's own week (weekday -> one of his routines); PUT replaces the whole week.

    Replacing the whole week makes a repeated request harmless. A deleted routine's day is left
    out: it is a rest day until the athlete picks another routine.
    """

    @staticmethod
    def week(user):
        days = ScheduleDay.objects.filter(owner=user, routine__archived_at__isnull=True).select_related('routine')
        return {'days': [{'weekday': d.weekday, 'routine_id': str(d.routine_id), 'name': d.routine.name} for d in days]}

    def get(self, request):
        return Response(self.week(request.user))

    @transaction.atomic
    def put(self, request):
        serializer = ScheduleSerializer(data=require_object_body(request), context={'request': request})
        serializer.is_valid(raise_exception=True)
        ScheduleDay.objects.filter(owner=request.user).delete()
        ScheduleDay.objects.bulk_create([
            ScheduleDay(owner=request.user, weekday=day['weekday'], routine=day['routine_id'])
            for day in serializer.validated_data['days']
        ])
        return Response(self.week(request.user))
