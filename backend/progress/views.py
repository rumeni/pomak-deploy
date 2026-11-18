import datetime

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.views import IdempotentCreateMixin

from . import overview, weekly
from accounts.models import User

from .models import Goal, Measurement, WeeklyCheckIn
from .serializers import GoalSerializer, GoalStatusSerializer, MeasurementSerializer


class MeasurementViewSet(
    IdempotentCreateMixin, mixins.ListModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin,
    mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    serializer_class = MeasurementSerializer
    retry_action = 'update'
    http_method_names = ['get', 'post', 'patch', 'delete']

    def get_queryset(self):
        qs = Measurement.objects.filter(user=self.request.user)
        kind = self.request.query_params.get('kind')
        return qs.filter(kind=kind) if kind else qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class GoalViewSet(IdempotentCreateMixin, mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Ciljevi napretka: aktivni prvi. Stanje se menja preko POST /goals/<id>/close/."""

    serializer_class = GoalSerializer
    retry_action = 'compare'
    retry_compare_fields = ('kind', 'target_value', 'target_date')

    def get_queryset(self):
        return Goal.objects.filter(user=self.request.user).select_related('user__profile')

    def list(self, request, *args, **kwargs):
        goals = sorted(self.get_queryset(), key=lambda g: g.status != Goal.Status.ACTIVE)
        return Response(self.get_serializer(goals, many=True).data)

    def perform_create(self, serializer):
        # Revalidate under a stable user-row lock: concurrent posts may both
        # pass the initial serializer check for the same active goal kind.
        with transaction.atomic():
            User.objects.select_for_update().get(pk=self.request.user.pk)
            kind = serializer.validated_data['kind']
            if Goal.objects.filter(user=self.request.user, kind=kind, status=Goal.Status.ACTIVE).exists():
                raise ValidationError(_('You already have an active goal of this kind.'))
            serializer.save(user=self.request.user)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        goal = self.get_object()
        body = GoalStatusSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        if goal.status == Goal.Status.ACTIVE:
            goal.status = body.validated_data['status']
            goal.closed_on = timezone.localdate()
            goal.save(update_fields=['status', 'closed_on', 'updated_at'])
        return Response(self.get_serializer(goal).data)


class WeekView(APIView):
    """Nedeljni pregled: ?start=2026-09-28 (bilo koji dan; uzima se ponedeljak te nedelje)."""

    def get(self, request):
        value = request.query_params.get('start')
        try:
            day = datetime.date.fromisoformat(value) if value else timezone.localdate()
        except ValueError:
            raise ValidationError({'start': _('Invalid date.')}) from None
        monday = overview.monday_of(day)
        # Dates in year 9999 can overflow when adding the final Sunday.
        if monday > datetime.date.max - datetime.timedelta(days=6):
            raise ValidationError({'start': _('Invalid date.')})
        return Response(overview.week_overview(request.user, monday))


def week_monday(value):
    """Any day of a week (YYYY-MM-DD) -> its Monday."""
    try:
        day = datetime.date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({'week': _('Invalid date.')}) from None
    monday = overview.monday_of(day)
    if monday > datetime.date.max - datetime.timedelta(days=6):
        raise ValidationError({'week': _('Invalid date.')})
    return monday


class WeeklyCheckInSerializer(serializers.Serializer):
    energy = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True, default=None)
    progress = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True, default=None)
    nutrition = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True, default=None)
    satisfaction = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True, default=None)
    hardest = serializers.CharField(max_length=500, required=False, allow_blank=True, default='', trim_whitespace=True)
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default='', trim_whitespace=True)


class WeekReviewView(APIView):
    """GET: the week in review. PUT: the athlete's check-in for that week (same request twice = same result)."""

    def get(self, request, day):
        return Response(weekly.week_review(request.user, week_monday(day)))

    def put(self, request, day):
        monday = week_monday(day)
        if not weekly.can_check_in(monday):
            raise ValidationError({'week': _('A check-in is for this week or one of the last eight.')})
        serializer = WeeklyCheckInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from coaching.models import CoachConnection
        from coaching.tasks import weekly_checkin_task

        # Written for the coach the athlete has now (the form says the coach sees it), or private
        # without one; a later coach never gets check-ins that were not written for him.
        coach = CoachConnection.objects.filter(client=request.user, ended_at__isnull=True).first()
        with transaction.atomic():
            checkin, _created = WeeklyCheckIn.objects.select_for_update().get_or_create(user=request.user, week_start=monday)
            for field, value in serializer.validated_data.items():
                setattr(checkin, field, value)
            checkin.shared_with = coach
            checkin.save()
        if coach is not None:
            weekly_checkin_task(coach.id, monday)
        return Response(weekly.week_review(request.user, monday))

