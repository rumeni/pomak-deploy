"""Program templates, assigning them and client plans (T2a). Every write locks the collaboration."""

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.views import require_object_body
from training.models import Routine

from .models import ClientPlan, CoachConnection, ProgramTemplate, ProgramTemplateDay
from .plans import (
    assignable_routine, attribute, check_valid_from, copy_routine, plan_routine_ids, plan_summary,
    retried_version, save_version, tailored_routine,
)
from .tasks import lock_active
from .views import coach_only, display_name

MAX_TEMPLATES = 100
MAX_ASSIGN_CLIENTS = 50


class TemplateDaySerializer(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    routine_id = serializers.UUIDField()


class TemplateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100, trim_whitespace=True)
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default='')
    weeks = serializers.IntegerField(min_value=1, max_value=52, required=False, allow_null=True, default=None)
    days = TemplateDaySerializer(many=True)

    def validate_days(self, value):
        if not value:
            raise serializers.ValidationError(_('Put a routine on at least one day.'))
        if len({d['weekday'] for d in value}) != len(value):
            raise serializers.ValidationError(_('One routine per day.'))
        return value


class PlanDaySerializer(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    # Exactly one: keep a routine already in this plan, copy one of the coach's, or a routine
    # adjusted for this client.
    keep_routine_id = serializers.UUIDField(required=False)
    routine_id = serializers.UUIDField(required=False)
    routine = serializers.DictField(required=False)

    def validate(self, attrs):
        given = [k for k in ('keep_routine_id', 'routine_id', 'routine') if k in attrs]
        if len(given) != 1:
            raise serializers.ValidationError(_('Choose one routine for the day.'))
        return attrs


class PlanVersionSerializer(serializers.Serializer):
    valid_from = serializers.DateField()
    weeks = serializers.IntegerField(min_value=1, max_value=52, required=False, allow_null=True, default=None)
    name = serializers.CharField(max_length=100, trim_whitespace=True, required=False, allow_blank=True, default='')
    reason = serializers.CharField(max_length=300, trim_whitespace=True, required=False, allow_blank=True, default='')
    request_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    # Empty: no plan from that date (a pause or the end of the plan).
    days = PlanDaySerializer(many=True)

    def validate_days(self, value):
        if len({d['weekday'] for d in value}) != len(value):
            raise serializers.ValidationError(_('One routine per day.'))
        return value

    def validate_valid_from(self, value):
        check_valid_from(value)
        return value


class AssignTemplateSerializer(serializers.Serializer):
    client_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=MAX_ASSIGN_CLIENTS)
    start_date = serializers.DateField()
    reason = serializers.CharField(max_length=300, trim_whitespace=True, required=False, allow_blank=True, default='')
    request_id = serializers.UUIDField(required=False, allow_null=True, default=None)

    def validate_start_date(self, value):
        check_valid_from(value)
        return value


def template_summary(template):
    days = list(template.days.select_related('routine'))
    return {
        'id': str(template.id), 'name': template.name, 'notes': template.notes, 'weeks': template.weeks,
        'days': [
            {'weekday': d.weekday, 'routine': {'id': str(d.routine_id), 'name': d.routine.name,
                                              'archived': d.routine.archived_at is not None}}
            for d in days
        ],
        'updated_at': template.updated_at,
    }


def coach_template(request, pk):
    coach_only(request)
    template = ProgramTemplate.objects.filter(pk=pk, coach=request.user, archived_at__isnull=True).first()
    if template is None:
        raise NotFound()
    return template


def write_template_days(request, template, days):
    template.days.all().delete()
    ProgramTemplateDay.objects.bulk_create([
        ProgramTemplateDay(template=template, weekday=d['weekday'], routine=assignable_routine(request.user, d['routine_id']))
        for d in days
    ])


class TemplatesView(APIView):
    def get(self, request):
        coach_only(request)
        templates = ProgramTemplate.objects.filter(coach=request.user, archived_at__isnull=True)
        return Response([template_summary(t) for t in templates])

    @transaction.atomic
    def post(self, request):
        coach_only(request)
        require_object_body(request)
        serializer = TemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if ProgramTemplate.objects.filter(coach=request.user, archived_at__isnull=True).count() >= MAX_TEMPLATES:
            raise ValidationError({'detail': _('Archive an old program before adding another one.')})
        data = serializer.validated_data
        template = ProgramTemplate.objects.create(coach=request.user, name=data['name'], notes=data['notes'], weeks=data['weeks'])
        write_template_days(request, template, data['days'])
        return Response(template_summary(template), status=status.HTTP_201_CREATED)


class TemplateView(APIView):
    def get(self, request, pk):
        return Response(template_summary(coach_template(request, pk)))

    @transaction.atomic
    def put(self, request, pk):
        require_object_body(request)
        template = coach_template(request, pk)
        serializer = TemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # The template only: clients' plans hold their own copies and stay as they are.
        template.name, template.notes, template.weeks = data['name'], data['notes'], data['weeks']
        template.save()
        write_template_days(request, template, data['days'])
        return Response(template_summary(template))

    def delete(self, request, pk):
        template = coach_template(request, pk)
        template.archived_at = timezone.now()
        template.save(update_fields=['archived_at', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AssignTemplateView(APIView):
    """Template → clients → start date. Each client gets his own copies, in his own transaction."""

    def post(self, request, pk):
        require_object_body(request)
        template = coach_template(request, pk)
        serializer = AssignTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        days = list(template.days.all())
        sources = {d.routine_id: assignable_routine(request.user, d.routine_id) for d in days}
        results = []
        for client_id in dict.fromkeys(data['client_ids']):
            connection_id = CoachConnection.objects.filter(
                coach=request.user, client_id=client_id, ended_at__isnull=True,
            ).values_list('id', flat=True).first()
            with transaction.atomic():
                connection = lock_active(connection_id) if connection_id else None
                if connection is None:
                    results.append({'client_id': str(client_id), 'ok': False, 'error': 'not_a_client'})
                    continue
                version = retried_version(connection, data['request_id'])
                if version is None:
                    copies = {}
                    for source_id, source in sources.items():
                        copies[source_id] = copy_routine(source, connection.client)
                        attribute(connection, copies[source_id])
                    version = save_version(
                        connection, valid_from=data['start_date'], weeks=template.weeks, name=template.name,
                        reason=data['reason'], template=template, request_id=data['request_id'],
                        days=[(d.weekday, copies[d.routine_id]) for d in days],
                    )
                results.append({'client_id': str(client_id), 'name': display_name(connection.client), 'ok': True,
                                'version_id': str(version.id)})
        return Response({'results': results})


def active_connection_for(request, client_id, *, lock=False):
    coach_only(request)
    query = CoachConnection.objects.filter(coach=request.user, client_id=client_id, ended_at__isnull=True)
    connection_id = query.values_list('id', flat=True).first()
    connection = (lock_active(connection_id) if lock else query.select_related('client__profile').first()) if connection_id else None
    if connection is None:
        raise NotFound()
    return connection


class ClientPlanView(APIView):
    def get(self, request, client_id):
        connection = active_connection_for(request, client_id)
        plan = ClientPlan.objects.filter(connection=connection).first()
        return Response(plan_summary(plan) if plan else None)


class ClientPlanVersionsView(APIView):
    """A change of the client's plan, valid from today or later (a pause when it has no days)."""

    @transaction.atomic
    def post(self, request, client_id):
        require_object_body(request)
        serializer = PlanVersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        connection = active_connection_for(request, client_id, lock=True)
        version = retried_version(connection, data['request_id'])
        if version is None:
            plan = ClientPlan.objects.filter(connection=connection).first()
            kept = plan_routine_ids(plan) if plan else set()
            days = []
            for day in data['days']:
                if 'keep_routine_id' in day:
                    if day['keep_routine_id'] not in kept:
                        raise ValidationError({'days': _('That routine is not part of this plan any more.')})
                    routine = Routine.objects.filter(pk=day['keep_routine_id'], owner=connection.client, archived_at__isnull=True).first()
                    if routine is None:
                        raise ValidationError({'days': _('That routine is not part of this plan any more.')})
                elif 'routine_id' in day:
                    routine = copy_routine(assignable_routine(request.user, day['routine_id']), connection.client)
                    attribute(connection, routine)
                else:
                    routine = tailored_routine(request, day['routine'], connection.client)
                    attribute(connection, routine)
                days.append((day['weekday'], routine))
            current_name = plan.versions.order_by('-valid_from').values_list('name', flat=True).first() if plan else None
            version = save_version(
                connection, valid_from=data['valid_from'], weeks=data['weeks'],
                name=data['name'] or current_name or str(_('Plan')), reason=data['reason'], template=None,
                request_id=data['request_id'], days=days,
            )
        return Response(plan_summary(version.plan), status=status.HTTP_201_CREATED)


class MyPlanView(APIView):
    """The client's plan from his coach (current collaboration), or null."""

    def get(self, request):
        connection = CoachConnection.objects.filter(client=request.user, ended_at__isnull=True).first()
        plan = ClientPlan.objects.filter(connection=connection).first() if connection else None
        return Response(plan_summary(plan) if plan else None)
