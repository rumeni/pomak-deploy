"""Small, permission-scoped coach/client API. All access checks run on every request.

A collaboration (CoachConnection) is active until either side ends it; then it stays as an
archive: both sides can still read the conversation (and the coach his notes), nobody can write,
and the coach loses access to the client's data. Response fields of the first version are kept,
so older Android builds keep working.
"""

import re
from datetime import timedelta
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from nutrition.models import MealEntry
from progress.models import Goal, Measurement
from training.models import Routine, RoutineExercise, RoutineSet, WorkoutSession
from training.readiness import readiness_answers, readiness_score
from core.views import require_object_body

from .models import (
    CoachAssignment, CoachConnection, CoachInvitation, CoachMessage, CoachNote, CoachProfile, CoachTask,
)
from .tasks import lock_active, sync_tasks, visible_tasks


MAX_ACTIVE_INVITES = 5
MAX_MESSAGES_RETURNED = 80
MAX_CLIENT_WORKOUTS = 12
MAX_NOTES_PER_CLIENT = 200
SNOOZE_DAYS = (1, 3, 7)


class CollaborationEnded(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = _('This collaboration has ended. The conversation can be read, but not continued.')
    default_code = 'collaboration_ended'


def coach_only(request):
    if not request.user.profile.is_coach:
        raise PermissionDenied('Only coach accounts can perform this action.')


def client_only(request):
    if request.user.profile.is_coach:
        raise PermissionDenied('A coach account cannot connect as a client.')


def active_connections():
    return CoachConnection.objects.filter(ended_at__isnull=True)


def connection_for_coach(request, client_id):
    coach_only(request)
    connection = active_connections().select_related('client__profile', 'coach__profile').filter(
        coach=request.user, client_id=client_id,
    ).first()
    if connection is None:
        raise NotFound()
    return connection


def parse_uuid(raw, field):
    try:
        return serializers.UUIDField().run_validation(raw)
    except serializers.ValidationError as error:
        raise ValidationError({field: error.detail}) from None


def participant_connection(request, connection_id):
    """Any collaboration (active or ended) the user is part of."""
    connection = CoachConnection.objects.select_related('coach__profile', 'client__profile').filter(
        Q(coach=request.user) | Q(client=request.user), pk=connection_id,
    ).first()
    if connection is None:
        raise NotFound()
    return connection


def connection_for_messages(request):
    # An ended collaboration is addressed by its ID (read-only archive).
    raw_connection = request.query_params.get('connection_id') or (
        request.data.get('connection_id') if request.method == 'POST' else None
    )
    if raw_connection:
        return participant_connection(request, parse_uuid(raw_connection, 'connection_id'))
    if request.user.profile.is_coach:
        # GET has no JSON body contract; POST validates an object first.
        raw_id = request.query_params.get('client_id') or (
            request.data.get('client_id') if request.method == 'POST' else None
        )
        if not raw_id:
            raise ValidationError({'client_id': 'Select a client.'})
        return connection_for_coach(request, parse_uuid(raw_id, 'client_id'))
    connection = active_connections().select_related('coach__profile', 'client__profile').filter(
        client=request.user,
    ).first()
    if connection is None:
        raise NotFound()
    return connection


def display_name(user):
    return user.profile.display_name.strip() or user.email.split('@')[0]


def connection_status(connection):
    if connection.ended_at is not None:
        return 'ended'
    return 'paused' if connection.paused_at is not None else 'active'


def connection_summary(connection):
    return {
        'id': str(connection.id),
        'coach': {'id': str(connection.coach_id), 'name': display_name(connection.coach)},
        'client': {'id': str(connection.client_id), 'name': display_name(connection.client)},
        'share_measurements': connection.share_measurements,
        'share_nutrition': connection.share_nutrition,
        'share_readiness': connection.share_readiness,
        'connected_at': connection.created_at,
        'status': connection_status(connection),
        'ended_at': connection.ended_at,
        'ended_by': connection.ended_by or None,
    }


def coach_card(user):
    """What a client may see about a coach: never the email or anything private."""
    profile = CoachProfile.objects.filter(user=user).first()
    return {
        'id': str(user.id),
        'name': display_name(user),
        'years_experience': profile.years_experience if profile else None,
        'specialties': profile.specialties if profile else [],
        'qualifications': profile.qualifications if profile else '',
        'bio': profile.bio if profile else '',
        'work_mode': profile.work_mode if profile else '',
        'gym_name': profile.gym_name if profile else '',
        'city': profile.city if profile else '',
        'address': profile.address if profile else '',
    }


def invitation_summary(invite):
    return {'id': str(invite.id), 'code': invite.code, 'expires_at': invite.expires_at, 'label': invite.label}


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


def note_summary(note):
    return {
        'id': str(note.id), 'text': note.text, 'visible_to_client': note.visible_to_client,
        'created_at': note.created_at, 'updated_at': note.updated_at,
    }


def task_summary(task, now):
    snoozed = task.status == CoachTask.Status.OPEN and task.snoozed_until is not None and task.snoozed_until > now
    return {
        'id': str(task.id),
        'kind': task.kind,
        'state': 'done' if task.status == CoachTask.Status.DONE else ('snoozed' if snoozed else 'open'),
        'snoozed_until': task.snoozed_until if snoozed else None,
        'resolved_at': task.resolved_at,
        'event_at': task.event_at,
        'data': task.data,
        'client': {'id': str(task.connection.client_id), 'name': display_name(task.connection.client)},
    }


def readiness_summary(session):
    answers = readiness_answers(session)
    return {'score': readiness_score(answers), 'answers': answers} if answers else None


class InviteSerializer(serializers.Serializer):
    # No public email lookup; client must explicitly enter a code provided by a coach.
    code = serializers.CharField(max_length=16, min_length=16)
    share_measurements = serializers.BooleanField(default=False)
    share_nutrition = serializers.BooleanField(default=False)
    share_readiness = serializers.BooleanField(default=False)

    def validate_code(self, value):
        value = value.strip().upper()
        if not re.fullmatch(r'[0-9A-F]{16}', value):
            raise serializers.ValidationError('Invalid invitation code.')
        return value


class InvitationLabelSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=60, required=False, allow_blank=True, trim_whitespace=True)


class SharingSerializer(serializers.Serializer):
    share_measurements = serializers.BooleanField(required=False)
    share_nutrition = serializers.BooleanField(required=False)
    share_readiness = serializers.BooleanField(required=False)


class ClientStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['active', 'paused'])


class AssignSerializer(serializers.Serializer):
    routine_id = serializers.UUIDField()


class MessageSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    text = serializers.CharField(max_length=800, trim_whitespace=True, allow_blank=False)


class NoteSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=2000, trim_whitespace=True, allow_blank=False)
    visible_to_client = serializers.BooleanField(default=False)


class NoteUpdateSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=2000, trim_whitespace=True, allow_blank=False, required=False)
    visible_to_client = serializers.BooleanField(required=False)


class TaskActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=['done', 'reopen', 'snooze'])
    days = serializers.ChoiceField(choices=SNOOZE_DAYS, required=False)

    def validate(self, attrs):
        if attrs['action'] == 'snooze' and 'days' not in attrs:
            raise serializers.ValidationError({'days': _('Choose for how long.')})
        return attrs


class CoachProfileSerializer(serializers.ModelSerializer):
    specialties = serializers.ListField(
        child=serializers.ChoiceField(choices=CoachProfile.SPECIALTIES), max_length=len(CoachProfile.SPECIALTIES),
        required=False,
    )
    # The starting questions send complete=true; their answers are then required.
    complete = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = CoachProfile
        fields = [
            'years_experience', 'specialties', 'qualifications', 'bio', 'work_mode',
            'gym_name', 'city', 'address', 'completed_at', 'complete',
        ]
        read_only_fields = ['completed_at']

    def validate_specialties(self, value):
        return list(dict.fromkeys(value))

    def validate(self, attrs):
        current = {f: getattr(self.instance, f) for f in self.Meta.fields if f != 'complete'} if self.instance else {}
        merged = {**current, **attrs}
        if attrs.get('complete') or (self.instance and self.instance.completed_at):
            errors = {}
            if merged.get('years_experience') is None:
                errors['years_experience'] = _('Tell clients how long you have been coaching.')
            if not merged.get('specialties'):
                errors['specialties'] = _('Choose at least one area you work in.')
            if not merged.get('work_mode'):
                errors['work_mode'] = _('Choose how you work with clients.')
            elif merged['work_mode'] != CoachProfile.WorkMode.ONLINE and not (merged.get('city') or '').strip():
                errors['city'] = _('Enter the city where you train clients.')
            if errors:
                raise serializers.ValidationError(errors)
        return attrs

    def save(self, **kwargs):
        complete = self.validated_data.pop('complete', False)
        if complete and not (self.instance and self.instance.completed_at):
            kwargs['completed_at'] = timezone.now()
        return super().save(**kwargs)


def profile_response(user, profile):
    data = CoachProfileSerializer(profile).data if profile else {
        'years_experience': None, 'completed_at': None, 'specialties': [], 'qualifications': '', 'bio': '',
        'work_mode': '', 'gym_name': '', 'city': '', 'address': '',
    }
    return {**data, 'name': display_name(user), 'specialty_choices': list(CoachProfile.SPECIALTIES)}


def coach_client_rows(connections, now):
    """Client list rows: status, last workout, workouts this week and open tasks."""
    client_ids = [c.client_id for c in connections]
    last = dict(
        WorkoutSession.objects.filter(owner_id__in=client_ids).values('owner_id')
        .annotate(last=Max('started_at')).values_list('owner_id', 'last')
    )
    week = dict(
        WorkoutSession.objects.filter(owner_id__in=client_ids, started_at__gte=now - timedelta(days=7))
        .values('owner_id').annotate(n=Count('id')).values_list('owner_id', 'n')
    )
    open_tasks = dict(
        CoachTask.objects.filter(connection__in=connections, status=CoachTask.Status.OPEN)
        .filter(Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now))
        .values('connection_id').annotate(n=Count('id')).values_list('connection_id', 'n')
    )
    return [
        {
            **connection_summary(c),
            'last_workout_at': last.get(c.client_id),
            'workouts_7d': week.get(c.client_id, 0),
            'open_tasks': open_tasks.get(c.id, 0),
        }
        for c in connections
    ]


class DashboardView(APIView):
    def get(self, request):
        now = timezone.now()
        if request.user.profile.is_coach:
            invitations = CoachInvitation.objects.filter(
                coach=request.user, redeemed_at__isnull=True, revoked_at__isnull=True, expires_at__gt=now,
            )[:MAX_ACTIVE_INVITES]
            connections = list(
                active_connections().filter(coach=request.user).select_related('client__profile', 'coach__profile')
                .order_by('created_at')
            )
            sync_tasks(connections)
            archived = (
                CoachConnection.objects.filter(coach=request.user, ended_at__isnull=False)
                .select_related('client__profile', 'coach__profile').order_by('-ended_at')[:50]
            )
            profile = CoachProfile.objects.filter(user=request.user).first()
            day_start = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
            return Response({
                'role': 'coach',
                'invitations': [invitation_summary(i) for i in invitations],
                'clients': coach_client_rows(connections, now),
                'archived_clients': [connection_summary(c) for c in archived],
                'profile_completed': bool(profile and profile.completed_at),
                'workouts_today': WorkoutSession.objects.filter(
                    owner_id__in=[c.client_id for c in connections], started_at__gte=day_start,
                ).count(),
            })
        connection = active_connections().filter(client=request.user).select_related('client__profile', 'coach__profile').first()
        assignments = (
            CoachAssignment.objects.filter(connection=connection).select_related('routine')[:30] if connection else []
        )
        archived = (
            CoachConnection.objects.filter(client=request.user, ended_at__isnull=False)
            .select_related('client__profile', 'coach__profile').order_by('-ended_at')[:20]
        )
        return Response({
            'role': 'client',
            'connection': connection_summary(connection) if connection else None,
            'coach': coach_card(connection.coach) if connection else None,
            'shared_notes': [
                note_summary(n) for n in CoachNote.objects.filter(connection=connection, visible_to_client=True)[:50]
            ] if connection else [],
            'assignments': [assignment_summary(x) for x in assignments if x.routine.archived_at is None],
            'archived': [connection_summary(c) for c in archived],
        })


class CoachProfileView(APIView):
    def get(self, request):
        coach_only(request)
        return Response(profile_response(request.user, CoachProfile.objects.filter(user=request.user).first()))

    @transaction.atomic
    def put(self, request):
        coach_only(request)
        require_object_body(request)
        profile, _created = CoachProfile.objects.select_for_update().get_or_create(user=request.user)
        serializer = CoachProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(profile_response(request.user, profile))


class InvitationCreateView(APIView):
    def post(self, request):
        coach_only(request)
        # Older apps send no body; a label ("for whom") is optional.
        body = request.data if isinstance(request.data, dict) else {}
        serializer = InvitationLabelSerializer(data=body)
        serializer.is_valid(raise_exception=True)
        # Count and insert under the SAME per-coach lock. Without this,
        # simultaneous tabs may both pass the 5-invitation limit.
        for _attempt in range(3):
            try:
                with transaction.atomic():
                    User.objects.select_for_update().get(pk=request.user.pk)
                    now = timezone.now()
                    if CoachInvitation.objects.filter(
                        coach=request.user, redeemed_at__isnull=True, revoked_at__isnull=True, expires_at__gt=now,
                    ).count() >= MAX_ACTIVE_INVITES:
                        raise ValidationError({'detail': 'Revoke an invitation before creating another one.'})
                    invite = CoachInvitation.objects.create(
                        coach=request.user, label=serializer.validated_data.get('label', ''),
                    )
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


class InvitationPreviewView(APIView):
    """Who the code belongs to, shown to the client before accepting. Only for valid codes."""

    def get(self, request):
        serializer = InviteSerializer(data={'code': request.query_params.get('code', '')})
        serializer.is_valid(raise_exception=True)
        invite = CoachInvitation.objects.select_related('coach__profile').filter(
            code=serializer.validated_data['code'], revoked_at__isnull=True, redeemed_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).first()
        if invite is None or not invite.coach.profile.is_coach:
            raise ValidationError({'code': 'Invalid or expired invitation code.'})
        return Response({'coach': coach_card(invite.coach), 'expires_at': invite.expires_at})


class ConnectView(APIView):
    def post(self, request):
        client_only(request)
        serializer = InviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if active_connections().filter(client=request.user).exists():
            raise ValidationError({'detail': 'Disconnect your current coach before connecting another one.'})
        code = serializer.validated_data['code']
        with transaction.atomic():
            invite = CoachInvitation.objects.select_for_update().filter(
                code=code, revoked_at__isnull=True, redeemed_at__isnull=True, expires_at__gt=timezone.now(),
            ).first()
            if invite is None or not invite.coach.profile.is_coach:
                raise ValidationError({'code': 'Invalid or expired invitation code.'})
            # The partial unique constraint also enforces this against concurrent connections.
            if active_connections().filter(client=request.user).exists():
                raise ValidationError({'detail': 'You already have a coach.'})
            try:
                with transaction.atomic():
                    connection = CoachConnection.objects.create(
                        coach=invite.coach, client=request.user,
                        share_measurements=serializer.validated_data['share_measurements'],
                        share_nutrition=serializer.validated_data['share_nutrition'],
                        share_readiness=serializer.validated_data['share_readiness'],
                    )
            except IntegrityError:
                raise ValidationError({'detail': 'You already have a coach.'}) from None
            invite.redeemed_at = timezone.now()
            invite.save(update_fields=['redeemed_at', 'updated_at'])
        return Response(connection_summary(connection), status=status.HTTP_201_CREATED)


def end_connection(connection, ended_by):
    """Archive instead of delete: the conversation stays readable, access to data stops."""
    now = timezone.now()
    connection.ended_at = now
    connection.ended_by = ended_by
    connection.save(update_fields=['ended_at', 'ended_by', 'updated_at'])
    # Tasks are about the client's current data, which the coach may no longer see.
    connection.tasks.all().delete()


class ConnectionView(APIView):
    @transaction.atomic
    def patch(self, request):
        client_only(request)
        serializer = SharingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        connection = active_connections().select_for_update().filter(client=request.user).first()
        if connection is None:
            raise NotFound()
        for key, value in serializer.validated_data.items():
            setattr(connection, key, value)
        if serializer.validated_data:
            connection.save(update_fields=[*serializer.validated_data.keys(), 'updated_at'])
        if not connection.share_readiness:
            # Revoked: the stored readiness answers in tasks go too, not just their display.
            connection.tasks.filter(kind=CoachTask.Kind.LOW_READINESS).delete()
        return Response(connection_summary(connection))

    @transaction.atomic
    def delete(self, request):
        client_only(request)
        connection = active_connections().select_for_update().filter(client=request.user).first()
        if connection is None:
            raise NotFound()
        end_connection(connection, CoachConnection.EndedBy.CLIENT)
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
                 'feeling': x.feeling, 'notes': x.notes, 'edited_at': x.edited_at,
                 'readiness': readiness_summary(x) if connection.share_readiness else None,
                 'exercises': [
                     {'name': item.exercise.name, 'sets': [
                         {'set_type': setlog.set_type, 'reps': setlog.reps, 'weight_kg': str(setlog.weight_kg) if setlog.weight_kg is not None else None,
                          'duration_seconds': setlog.duration_seconds, 'distance_m': setlog.distance_m,
                          'rpe': str(setlog.rpe) if setlog.rpe is not None else None}
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
            # Count nulls on SOURCE columns before reusing protein_g/carbs_g/fat_g
            # as SUM aliases. In a single annotate(), those filters can resolve
            # to the aggregate alias and produce invalid PostgreSQL SQL.
            rows = MealEntry.objects.filter(owner=client, date__gte=start, date__lte=timezone.localdate()).values('date').annotate(
                protein_unknown=Count('id', filter=Q(protein_g__isnull=True)),
                carbs_unknown=Count('id', filter=Q(carbs_g__isnull=True)),
                fat_unknown=Count('id', filter=Q(fat_g__isnull=True)),
            ).annotate(
                kcal=Sum('kcal'), protein_g=Sum('protein_g'), carbs_g=Sum('carbs_g'), fat_g=Sum('fat_g'),
            ).order_by('date')
            data['nutrition_days'] = [
                # Decimal totals stay serialized as strings, but Count()
                # results MUST remain JSON numbers for i18next pluralization.
                {key: (str(value) if key in ('kcal', 'protein_g', 'carbs_g', 'fat_g') and value is not None else value)
                 for key, value in row.items()}
                for row in rows
            ]
        return Response(data)

    @transaction.atomic
    def patch(self, request, client_id):
        """Pause (no inactivity tasks while away) or resume a client."""
        coach_only(request)
        serializer = ClientStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        connection = active_connections().select_for_update(of=('self',)).select_related('coach__profile', 'client__profile').filter(
            coach=request.user, client_id=client_id,
        ).first()
        if connection is None:
            raise NotFound()
        now = timezone.now()
        if serializer.validated_data['status'] == 'paused' and connection.paused_at is None:
            connection.paused_at = now
            connection.save(update_fields=['paused_at', 'updated_at'])
            connection.tasks.filter(kind=CoachTask.Kind.INACTIVE, status=CoachTask.Status.OPEN).update(
                status=CoachTask.Status.DONE, resolved_at=now, auto_resolved=True,
            )
        elif serializer.validated_data['status'] == 'active' and connection.paused_at is not None:
            # Inactivity counts again from now, not from before the pause.
            connection.paused_at = None
            connection.active_since = now
            connection.save(update_fields=['paused_at', 'active_since', 'updated_at'])
        return Response(connection_summary(connection))

    @transaction.atomic
    def delete(self, request, client_id):
        coach_only(request)
        connection = active_connections().select_for_update().filter(coach=request.user, client_id=client_id).first()
        if connection is None:
            raise NotFound()
        end_connection(connection, CoachConnection.EndedBy.COACH)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AssignRoutineView(APIView):
    @transaction.atomic
    def post(self, request, client_id):
        coach_only(request)
        # Serialize all writes on this relationship with disconnects and messages.
        connection = active_connections().select_for_update().filter(coach=request.user, client_id=client_id).first()
        if connection is None:
            raise NotFound()
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
                    duration_seconds=s.duration_seconds, distance_m=s.distance_m, rpe=s.rpe,
                ) for s in item.sets.all()
            ])
        assignment = CoachAssignment.objects.create(connection=connection, routine=clone)
        return Response(assignment_summary(assignment), status=status.HTTP_201_CREATED)


class MessagesView(APIView):
    def get(self, request):
        connection = connection_for_messages(request)
        rows = CoachMessage.objects.filter(connection=connection)
        params = request.query_params
        if 'before' in params or 'before_id' in params:
            raw_date, raw_id = params.get('before', ''), params.get('before_id', '')
            try:
                before = parse_datetime(raw_date) if len(raw_date) <= 64 else None
                before_id = UUID(raw_id)
            except (ValueError, TypeError, AttributeError):
                before, before_id = None, None
            if before is None or before_id is None or timezone.is_naive(before):
                raise ValidationError({'before': 'Invalid message cursor.'})
            rows = rows.filter(
                Q(created_at__lt=before) | Q(created_at=before, pk__lt=before_id)
            )
        # Retain the legacy chronological array and the last-80 default for
        # older Android clients. New clients use the FIRST (oldest) row as cursor.
        items = list(rows.order_by('-created_at', '-id')[:MAX_MESSAGES_RETURNED])
        return Response([message_summary(x) for x in reversed(items)])

    @transaction.atomic
    def post(self, request):
        require_object_body(request)
        relation = connection_for_messages(request)
        serializer = MessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        connection = CoachConnection.objects.select_for_update().filter(pk=relation.pk).first()
        if connection is None:
            raise NotFound()
        message_id = serializer.validated_data.get('id')
        text = serializer.validated_data['text']
        if message_id:
            # A retry of a message that was already stored returns it, even after the end.
            existing = CoachMessage.objects.filter(pk=message_id).first()
            if existing is not None:
                if existing.connection_id != connection.pk or existing.sender_id != request.user.pk:
                    raise ValidationError({'id': 'This message ID is already in use.'})
                if existing.text != text:
                    raise ValidationError({'id': 'This message ID has different content.'})
                return Response(message_summary(existing), status=status.HTTP_200_OK)
        # Checked under the lock: an end that committed meanwhile wins.
        if connection.ended_at is not None:
            raise CollaborationEnded()
        message = CoachMessage.objects.create(
            **({'id': message_id} if message_id else {}),
            connection=connection, sender=request.user, text=text,
        )
        return Response(message_summary(message), status=status.HTTP_201_CREATED)


class ConversationsView(APIView):
    """Every conversation of the user, active first, then archived, each with its last message."""

    def get(self, request):
        rows = list(
            CoachConnection.objects.filter(Q(coach=request.user) | Q(client=request.user))
            .select_related('coach__profile', 'client__profile')
        )
        last = {
            m.connection_id: m for m in CoachMessage.objects.filter(connection__in=rows)
            .order_by('connection_id', '-created_at', '-id').distinct('connection_id')
        }
        result = [
            {**connection_summary(c), 'last_message': message_summary(last[c.id]) if c.id in last else None}
            for c in rows
        ]

        def newest(row):
            return row['last_message']['created_at'] if row['last_message'] else row['connected_at']

        result.sort(key=lambda r: (r['status'] == 'ended', -newest(r).timestamp()))
        return Response(result)


def note_connection(request, connection_id, *, write=False):
    connection = participant_connection(request, connection_id)
    is_coach = connection.coach_id == request.user.id
    if write:
        if not is_coach:
            raise PermissionDenied('Only the coach writes notes.')
        if connection.ended_at is not None:
            raise CollaborationEnded()
    return connection, is_coach


class NotesView(APIView):
    def get(self, request, connection_id):
        connection, is_coach = note_connection(request, connection_id)
        notes = CoachNote.objects.filter(connection=connection)
        # Private notes are the coach's alone; the client only ever gets shared ones.
        if not is_coach:
            notes = notes.filter(visible_to_client=True)
        return Response([note_summary(n) for n in notes[:MAX_NOTES_PER_CLIENT]])

    @transaction.atomic
    def post(self, request, connection_id):
        require_object_body(request)
        connection, _is_coach = note_connection(request, connection_id, write=True)
        connection = CoachConnection.objects.select_for_update().get(pk=connection.pk)
        if connection.ended_at is not None:
            raise CollaborationEnded()
        serializer = NoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if CoachNote.objects.filter(connection=connection).count() >= MAX_NOTES_PER_CLIENT:
            raise ValidationError({'detail': _('Delete an old note before adding another one.')})
        note = CoachNote.objects.create(connection=connection, **serializer.validated_data)
        return Response(note_summary(note), status=status.HTTP_201_CREATED)


class NoteView(APIView):
    def _note(self, request, pk):
        """The note, locked, under a lock on its collaboration (same order as ending it), so an end
        that commits meanwhile is seen and an archived note never changes. Call inside atomic()."""
        coach_only(request)
        connection_id = CoachNote.objects.filter(pk=pk, connection__coach=request.user).values_list('connection_id', flat=True).first()
        if connection_id is None:
            raise NotFound()
        connection = CoachConnection.objects.select_for_update().get(pk=connection_id)
        if connection.ended_at is not None:
            raise CollaborationEnded()
        note = CoachNote.objects.select_for_update().filter(pk=pk, connection=connection).first()
        if note is None:
            raise NotFound()
        return note

    @transaction.atomic
    def patch(self, request, pk):
        require_object_body(request)
        serializer = NoteUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = self._note(request, pk)
        for key, value in serializer.validated_data.items():
            setattr(note, key, value)
        note.save()
        return Response(note_summary(note))

    @transaction.atomic
    def delete(self, request, pk):
        self._note(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TasksView(APIView):
    def get(self, request):
        coach_only(request)
        sync_tasks(list(active_connections().filter(coach=request.user)))
        now = timezone.now()
        return Response([task_summary(t, now) for t in visible_tasks(request.user, now)])


class TaskView(APIView):
    @transaction.atomic
    def patch(self, request, pk):
        coach_only(request)
        require_object_body(request)
        serializer = TaskActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Collaboration first, then the task (the order every task writer uses), so consent and the
        # end are checked on what is current; a task the coach may no longer see does not exist.
        found = CoachTask.objects.filter(pk=pk, connection__coach=request.user).values_list('connection_id', 'kind').first()
        if found is None:
            raise NotFound()
        connection = lock_active(found[0])
        if connection is None or (found[1] == CoachTask.Kind.LOW_READINESS and not connection.share_readiness):
            raise NotFound()
        task = CoachTask.objects.select_for_update(of=('self',)).select_related('connection__client__profile').filter(
            pk=pk, connection=connection,
        ).first()
        if task is None:
            raise NotFound()
        now = timezone.now()
        action = serializer.validated_data['action']
        if action == 'done':
            task.status, task.resolved_at, task.snoozed_until = CoachTask.Status.DONE, now, None
        elif action == 'reopen':
            task.status, task.resolved_at, task.snoozed_until = CoachTask.Status.OPEN, None, None
        else:
            task.status, task.resolved_at = CoachTask.Status.OPEN, None
            task.snoozed_until = now + timedelta(days=serializer.validated_data['days'])
        task.auto_resolved = False
        task.save(update_fields=['status', 'resolved_at', 'auto_resolved', 'snoozed_until', 'updated_at'])
        return Response(task_summary(task, now))
