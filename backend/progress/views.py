import datetime

from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.views import IdempotentCreateMixin

from . import overview
from .models import Goal, Measurement
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
    retry_action = 'conflict'

    def get_queryset(self):
        return Goal.objects.filter(user=self.request.user).select_related('user__profile')

    def list(self, request, *args, **kwargs):
        goals = sorted(self.get_queryset(), key=lambda g: g.status != Goal.Status.ACTIVE)
        return Response(self.get_serializer(goals, many=True).data)

    def perform_create(self, serializer):
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
