import datetime
from decimal import Decimal

from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from . import overview
from .models import Goal, Measurement

# Razumne granice po vrsti merenja; štite od grešaka u kucanju (npr. 785 umesto 78,5).
LIMITS = {
    Measurement.Kind.WEIGHT: (Decimal('25'), Decimal('350')),
}
DEFAULT_LIMITS = (Decimal('10'), Decimal('250'))


class MeasurementSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)

    class Meta:
        model = Measurement
        fields = ['id', 'kind', 'value', 'unit', 'measured_on', 'note', 'created_at']
        read_only_fields = ['unit', 'created_at']

    def validate_measured_on(self, value):
        # Dan više zbog razlike u vremenskoj zoni telefona i servera.
        if value > timezone.localdate() + datetime.timedelta(days=1):
            raise serializers.ValidationError(_('A measurement cannot be in the future.'))
        return value

    def validate(self, attrs):
        kind = attrs.get('kind', getattr(self.instance, 'kind', None))
        value = attrs.get('value', getattr(self.instance, 'value', None))
        low, high = LIMITS.get(kind, DEFAULT_LIMITS)
        if value is not None and not low <= value <= high:
            raise serializers.ValidationError({
                'value': _('The value must be between %(low)s and %(high)s.') % {'low': low, 'high': high},
            })
        return attrs


class GoalSerializer(serializers.ModelSerializer):
    """Cilj napretka. Polazna vrednost telesne mere je poslednje merenje (ako ga ima)."""

    id = serializers.UUIDField(required=False)
    state = serializers.SerializerMethodField()

    class Meta:
        model = Goal
        fields = ['id', 'kind', 'start_value', 'target_value', 'start_date', 'target_date', 'status', 'closed_on', 'state', 'created_at']
        read_only_fields = ['start_date', 'status', 'closed_on', 'created_at']

    def get_state(self, goal) -> dict:
        return overview.goal_state(goal, timezone.localdate())

    def validate(self, attrs):
        user = self.context['request'].user
        kind, target = attrs['kind'], attrs['target_value']
        today = timezone.localdate()
        if Goal.objects.filter(user=user, kind=kind, status=Goal.Status.ACTIVE).exists():
            raise serializers.ValidationError(_('You already have an active goal of this kind.'))
        if attrs.get('target_date') and attrs['target_date'] <= today:
            raise serializers.ValidationError({'target_date': _('The goal date must be in the future.')})
        if kind == Goal.Kind.WORKOUTS:
            if target != int(target) or not 1 <= target <= 14:
                raise serializers.ValidationError({'target_value': _('Enter a whole number of workouts from 1 to 14.')})
            attrs['start_value'] = None
        else:
            low, high = LIMITS.get(kind, DEFAULT_LIMITS)
            if not low <= target <= high:
                raise serializers.ValidationError({
                    'target_value': _('The value must be between %(low)s and %(high)s.') % {'low': low, 'high': high},
                })
            latest = overview.latest_measurement(user, kind)
            if latest is not None:
                attrs['start_value'] = latest.value
            elif attrs.get('start_value') is None:
                raise serializers.ValidationError({'start_value': _('Enter the current value.')})
            if attrs['start_value'] == target:
                raise serializers.ValidationError({'target_value': _('The goal must differ from the current value.')})
        attrs['start_date'] = today
        return attrs

    def create(self, validated_data):
        goal = super().create(validated_data)
        # Upisana polazna vrednost bez ranijeg merenja postaje prvo merenje.
        if goal.kind != Goal.Kind.WORKOUTS and not Measurement.objects.filter(user=goal.user, kind=goal.kind).exists():
            Measurement.objects.create(user=goal.user, kind=goal.kind, value=goal.start_value, measured_on=goal.start_date)
        return goal


class GoalStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[Goal.Status.ACHIEVED, Goal.Status.ABANDONED])
