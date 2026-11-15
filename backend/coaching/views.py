"""Small, permission-scoped coach/client API. All access checks run on every request."""

import re
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from nutrition.models import MealEntry
from progress.models import Goal, Measurement
from training.models import Routine, RoutineExercise, RoutineSet, WorkoutSession

from .models import CoachAssignment, CoachConnection, CoachInvitation, CoachMessage


MAX_ACTIVE_INVITES = 5
MAX_MESSAGES_RETURNED = 80
MAX_CLIENT_WORKOUTS = 12


def coach_only(request):
    if not request.user.profile.is_coach:
        raise PermissionDenied('Only coach accounts can perform this action.')


def client_only(request):
    if request.user.profile.is_coach:
        raise PermissionDenied('A coach account cannot connect as a client.')


def connection_for_coach(request, client_id):
    coach_only(request)
    connection = CoachConnection.objects.select_related('client__profile', 'coach__profile').filter(
        coach=request.user, client_id=client_id,
    ).first()
    if connection is None:
        raise NotFound()
    return connection


def connection_for_messages(request):
    if request.user.profile.is_coach:
        raw_id = request.query_params.get('client_id') or request.data.get('client_id')
        if not raw_id:
            raise ValidationError({'client_id': 'Select a client.'})
        try:
            client_id = serializers.UUIDField().run_validation(raw_id)
        except serializers.ValidationError as error:
            raise ValidationError({'client_id': error.detail}) from None
        return connection_for_coach(request, client_id)
    connection = CoachConnection.objects.select_related('coach__profile', 'client__profile').filter(
        client=request.user,
    ).first()
    if connection is None:
        raise NotFound()
    return connection


def display_name(user):
    return user.profile.display_name.strip() or user.email.split('@')[0]


def connection_summary(connection):
    return {
        'id': str(connection.id),
        'coach': {'id': str(connection.coach_id), 'name': display_name(connection.coach)},
        'client': {'id': str(connection.client_id), 'name': display_name(connection.client)},
        'share_measurements': connection.share_measurements,
        'share_nutrition': connection.share_nutrition,
        'connected_at': connection.created_at,
    }


def invitation_summary(invite):
    return {'id': str(invite.id), 'code': invite.code, 'expires_at': invite.expires_at}


def assignment_summary(item):
    return {
        'id': str(item.id), 'routine_id': str(item.routine_id), 'name': item.routine.name,
        'assigned_at': item.created_at,
    }


def message_summary(item):
    return {
        'id': str(item.id), 'sender_id': str(item.sender_id), 'text': item.text,
        'created_at': item.created_at,
    }


class InviteSerializer(serializers.Serializer):
    # No public email lookup; client must explicitly enter a code provided by a coach.
    code = serializers.CharField(max_length=16, min_length=16)
    share_measurements = serializers.BooleanField(default=False)
    share_nutrition = serializers.BooleanField(default=False)

    def validate_code(self, value):
        value = value.strip().upper()
        if not re.fullmatch(r'[0-9A-F]{16}', value):
            raise serializers.ValidationError('Invalid invitation code.')
        return value


class SharingSerializer(serializers.Serializer):
    share_measurements = serializers.BooleanField(required=False)
    share_nutrition = serializers.BooleanField(required=False)


class AssignSerializer(serializers.Serializer):
    routine_id = serializers.UUIDField()


class MessageSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=800, trim_whitespace=True, allow_blank=False)


class DashboardView(APIView):
    def get(self, request):
        if request.user.profile.is_coach:
            now = timezone.now()
            invitations = CoachInvitation.objects.filter(
                coach=request.user, redeemed_at__isnull=True, revoked_at__isnull=True, expires_at__gt=now,
            )[:MAX_ACTIVE_INVITES]
            connections = CoachConnection.objects.filter(coach=request.user).select_related('client__profile', 'coach__profile')
            return Response({
                'role': 'coach',
                'invitations': [invitation_summary(i) for i in invitations],
                'clients': [connection_summary(c) for c in connections],
            })
        connection = CoachConnection.objects.filter(client=request.user).select_related('client__profile', 'coach__profile').first()
        assignments = (
            CoachAssignment.objects.filter(connection=connection).select_related('routine')[:30] if connection else []
        )
        return Response({
            'role': 'client',
            'connection': connection_summary(connection) if connection else None,
            'assignments': [assignment_summary(x) for x in assignments if x.routine.archived_at is None],
        })


class InvitationCreateView(APIView):
    def post(self, request):
        coach_only(request)
        now = timezone.now()
        if CoachInvitation.objects.filter(
            coach=request.user, redeemed_at__isnull=True, revoked_at__isnull=True, expires_at__gt=now,
        ).count() >= MAX_ACTIVE_INVITES:
            raise ValidationError({'detail': 'Revoke an invitation before creating another one.'})
        # Very unlikely token collision; still retry without exposing DB errors.
        for _ in range(3):
            try:
                with transaction.atomic():
                    invite = CoachInvitation.objects.create(coach=request.user)
                return Response(invitation_summary(invite), status=status.HTTP_201_CREATED)
            except IntegrityError:
                continue
        raise ValidationError({'detail': 'Could not create an invitation. Try again.'})


class InvitationRevokeView(APIView):
    def delete(self, request, pk):
        coach_only(request)
        changed = CoachInvitation.objects.filter(
            id=pk, coach=request.user, redeemed_at__isnull=True, revoked_at__isnull=True,
        ).update(revoked_at=timezone.now())
        if not changed:
            raise NotFound()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConnectView(APIView):
    def post(self, request):
        client_only(request)
        serializer = InviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if CoachConnection.objects.filter(client=request.user).exists():
            raise ValidationError({'detail': 'Disconnect your current coach before connecting another one.'})
        code = serializer.validated_data['code']
        with transaction.atomic():
            invite = CoachInvitation.objects.select_for_update().filter(
                code=code, revoked_at__isnull=True, redeemed_at__isnull=True, expires_at__gt=timezone.now(),
            ).first()
            if invite is None or not invite.coach.profile.is_coach:
                raise ValidationError({'code': 'Invalid or expired invitation code.'})
            # The unique client FK also enforces this against concurrent connections with different codes.
            if CoachConnection.objects.filter(client=request.user).exists():
                raise ValidationError({'detail': 'You already have a coach.'})
            try:
                connection = CoachConnection.objects.create(
                    coach=invite.coach, client=request.user,
                    share_measurements=serializer.validated_data['share_measurements'],
                    share_nutrition=serializer.validated_data['share_nutrition'],
                )
            except IntegrityError:
                raise ValidationError({'detail': 'You already have a coach.'}) from None
            invite.redeemed_at = timezone.now()
            invite.save(update_fields=['redeemed_at', 'updated_at'])
        return Response(connection_summary(connection), status=status.HTTP_201_CREATED)


class ConnectionView(APIView):
    def patch(self, request):
        client_only(request)
        serializer = SharingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        connection = CoachConnection.objects.select_related('coach__profile', 'client__profile').filter(client=request.user).first()
        if connection is None:
            raise NotFound()
        for key, value in serializer.validated_data.items():
            setattr(connection, key, value)
        if serializer.validated_data:
            connection.save(update_fields=[*serializer.validated_data.keys(), 'updated_at'])
        return Response(connection_summary(connection))

    def delete(self, request):
        client_only(request)
        deleted, _ = CoachConnection.objects.filter(client=request.user).delete()
        if not deleted:
            raise NotFound()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CoachClientView(APIView):
    def get(self, request, client_id):
        connection = connection_for_coach(request, client_id)
        client = connection.client
        since = timezone.now() - timedelta(days=30)
        recent = list(WorkoutSession.objects.filter(owner=client).prefetch_related('exercises__exercise', 'exercises__sets').order_by('-started_at')[:MAX_CLIENT_WORKOUTS])
        active_goals = Goal.objects.filter(user=client, status=Goal.Status.ACTIVE)
        goals = [
            {'kind': g.kind, 'target_value': str(g.target_value), 'target_date': g.target_date}
            for g in active_goals
            if g.kind == Goal.Kind.WORKOUTS or connection.share_measurements
        ]
        data = {
            'connection': connection_summary(connection),
            'workouts_30d': WorkoutSession.objects.filter(owner=client, started_at__gte=since).count(),
            'recent_workouts': [
                {'id': str(x.id), 'name': x.name, 'started_at': x.started_at, 'finished_at': x.finished_at,
                 'feeling': x.feeling, 'notes': x.notes,
                 'exercises': [
                     {'name': item.exercise.name, 'sets': [
                         {'reps': setlog.reps, 'weight_kg': str(setlog.weight_kg) if setlog.weight_kg is not None else None,
                          'duration_seconds': setlog.duration_seconds, 'distance_m': setlog.distance_m}
                         for setlog in item.sets.all()
                     ]}
                     for item in x.exercises.all()
                 ]}
                for x in recent
            ],
            'goals': goals,
            'measurements': None,
            'nutrition_days': None,
            'assignments': [assignment_summary(x) for x in CoachAssignment.objects.filter(connection=connection).select_related('routine')[:30]],
        }
        if connection.share_measurements:
            data['measurements'] = [
                {'kind': x.kind, 'value': str(x.value), 'unit': x.unit, 'measured_on': x.measured_on}
                for x in Measurement.objects.filter(user=client).order_by('-measured_on', '-created_at')[:20]
            ]
        if connection.share_nutrition:
            start = timezone.localdate() - timedelta(days=6)
            rows = MealEntry.objects.filter(owner=client, date__gte=start, date__lte=timezone.localdate()).values('date').annotate(
                kcal=Sum('kcal'), protein_g=Sum('protein_g'), carbs_g=Sum('carbs_g'), fat_g=Sum('fat_g'),
            ).order_by('date')
            data['nutrition_days'] = [
                {key: (str(value) if key != 'date' and value is not None else value) for key, value in row.items()}
                for row in rows
            ]
        return Response(data)

    def delete(self, request, client_id):
        connection = connection_for_coach(request, client_id)
        connection.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AssignRoutineView(APIView):
    @transaction.atomic
    def post(self, request, client_id):
        connection = connection_for_coach(request, client_id)
        # Lock the connection against concurrent disconnects while creating the copy.
        connection = CoachConnection.objects.select_for_update().get(pk=connection.pk)
        serializer = AssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        source = Routine.objects.filter(
            pk=serializer.validated_data['routine_id'], owner=request.user, archived_at__isnull=True,
        ).prefetch_related('exercises__sets', 'exercises__exercise').first()
        if source is None:
            raise ValidationError({'routine_id': 'Select one of your active routines.'})
        rows = list(source.exercises.all())
        if not rows:
            raise ValidationError({'routine_id': 'A routine must contain at least one exercise.'})
        if any(x.exercise.owner_id is not None for x in rows):
            raise ValidationError({'routine_id': 'This routine uses private exercises. Use shared exercises before assigning.'})
        clone = Routine.objects.create(owner=connection.client, name=source.name, notes=source.notes)
        for item in rows:
            exercise = RoutineExercise.objects.create(
                routine=clone, exercise=item.exercise, position=item.position,
                rest_seconds=item.rest_seconds, notes=item.notes,
            )
            RoutineSet.objects.bulk_create([
                RoutineSet(
                    routine_exercise=exercise, position=s.position, set_type=s.set_type,
                    reps_min=s.reps_min, reps_max=s.reps_max, weight_kg=s.weight_kg,
                    duration_seconds=s.duration_seconds, distance_m=s.distance_m,
                ) for s in item.sets.all()
            ])
        assignment = CoachAssignment.objects.create(connection=connection, routine=clone)
        return Response(assignment_summary(assignment), status=status.HTTP_201_CREATED)


class MessagesView(APIView):
    def get(self, request):
        connection = connection_for_messages(request)
        items = list(CoachMessage.objects.filter(connection=connection).order_by('-created_at', '-id')[:MAX_MESSAGES_RETURNED])
        return Response([message_summary(x) for x in reversed(items)])

    def post(self, request):
        connection = connection_for_messages(request)
        serializer = MessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = CoachMessage.objects.create(
            connection=connection, sender=request.user, text=serializer.validated_data['text'],
        )
        return Response(message_summary(message), status=status.HTTP_201_CREATED)
