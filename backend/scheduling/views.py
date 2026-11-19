from datetime import date, datetime, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from coaching.models import CoachConnection
from coaching.views import client_only, coach_only, display_name
from core.views import require_object_body

from . import services
from .availability import LOCAL, booking_settings, free_slots
from .models import Booking, BookingSettings, ScheduleException, SessionType, WorkingHours

MAX_RANGE_DAYS = 42
MAX_WINDOWS_PER_DAY = 3


# ---- shapes ---------------------------------------------------------------------------------

def session_type_summary(t):
    return {'id': str(t.id), 'name': t.name, 'duration_minutes': t.duration_minutes, 'mode': t.mode,
            'archived': t.archived_at is not None}


def booking_summary(b, *, viewer, now=None):
    now = now or timezone.now()
    is_coach = viewer.pk == b.coach_id
    return {
        'id': str(b.id), 'starts_at': b.starts_at, 'ends_at': b.ends_at, 'status': b.status,
        'session_type': session_type_summary(b.session_type),
        'coach': {'id': str(b.coach_id), 'name': display_name(b.coach)},
        'client': {'id': str(b.client_id), 'name': display_name(b.client)},
        'connection_id': str(b.connection_id), 'note': b.note, 'created_by': b.created_by,
        'cancelled_by': b.cancelled_by or None, 'cancel_reason': b.cancel_reason,
        'can_cancel': (b.status in Booking.HOLDS_TIME and b.ends_at > now) if is_coach else services.can_client_cancel(b, now),
    }


def settings_summary(rules):
    return {'auto_confirm': rules.auto_confirm, 'cancel_hours': rules.cancel_hours, 'min_notice_hours': rules.min_notice_hours,
            'horizon_days': rules.horizon_days, 'slot_step_minutes': rules.slot_step_minutes}


def date_range(request, *, default_days=7):
    """`from` / `to` local dates (inclusive), at most six weeks."""
    try:
        first = date.fromisoformat(request.query_params['from']) if request.query_params.get('from') else timezone.localdate()
        last = date.fromisoformat(request.query_params['to']) if request.query_params.get('to') else first + timedelta(days=default_days - 1)
    except ValueError:
        raise ValidationError({'from': 'Use YYYY-MM-DD dates.'}) from None
    if last < first or (last - first).days >= MAX_RANGE_DAYS:
        raise ValidationError({'to': f'A range of 1 to {MAX_RANGE_DAYS} days.'})
    return first, last


def local_bounds(first, last):
    return datetime.combine(first, datetime.min.time(), LOCAL), datetime.combine(last + timedelta(days=1), datetime.min.time(), LOCAL)


def client_connection(request):
    client_only(request)
    connection = CoachConnection.objects.filter(client=request.user, ended_at__isnull=True).select_related('coach__profile').first()
    if connection is None:
        raise NotFound({'detail': _('You have no coach at the moment.'), 'code': 'no_coach'})
    return connection


# ---- the coach's setup ----------------------------------------------------------------------

class SettingsSerializer(serializers.Serializer):
    auto_confirm = serializers.BooleanField()
    cancel_hours = serializers.IntegerField(min_value=0, max_value=168)
    min_notice_hours = serializers.IntegerField(min_value=0, max_value=168)
    horizon_days = serializers.IntegerField(min_value=1, max_value=90)
    slot_step_minutes = serializers.ChoiceField(choices=[15, 30, 60])


class SettingsView(APIView):
    def get(self, request):
        coach_only(request)
        return Response(settings_summary(booking_settings(request.user)))

    def put(self, request):
        coach_only(request)
        serializer = SettingsSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        rules, _created = BookingSettings.objects.update_or_create(coach=request.user, defaults=serializer.validated_data)
        return Response(settings_summary(rules))


class SessionTypeSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80, trim_whitespace=True)
    duration_minutes = serializers.IntegerField(min_value=15, max_value=240)
    mode = serializers.ChoiceField(choices=SessionType.Mode.choices)


class SessionTypesView(APIView):
    def get(self, request):
        coach_only(request)
        rows = SessionType.objects.filter(coach=request.user, archived_at__isnull=True)
        return Response([session_type_summary(t) for t in rows])

    def post(self, request):
        coach_only(request)
        serializer = SessionTypeSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        if SessionType.objects.filter(coach=request.user, archived_at__isnull=True).count() >= 20:
            raise ValidationError({'name': _('At most 20 session types.')})
        item = SessionType.objects.create(coach=request.user, **serializer.validated_data)
        return Response(session_type_summary(item), status=status.HTTP_201_CREATED)


class SessionTypeView(APIView):
    def item(self, request, pk):
        coach_only(request)
        item = SessionType.objects.filter(pk=pk, coach=request.user, archived_at__isnull=True).first()
        if item is None:
            raise NotFound()
        return item

    def put(self, request, pk):
        item = self.item(request, pk)
        serializer = SessionTypeSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        # A new length only applies to new bookings: existing ones keep their times.
        for field, value in serializer.validated_data.items():
            setattr(item, field, value)
        item.save()
        return Response(session_type_summary(item))

    def delete(self, request, pk):
        item = self.item(request, pk)
        item.archived_at = timezone.now()  # past and booked sessions keep their type
        item.save(update_fields=['archived_at', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WindowSerializer(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    start = serializers.TimeField()
    end = serializers.TimeField()

    def validate(self, data):
        if data['end'] <= data['start']:
            raise serializers.ValidationError({'end': _('The end must be after the start.')})
        return data


class HoursView(APIView):
    """The weekly working hours, replaced as a whole."""

    def get(self, request):
        coach_only(request)
        return Response(self.listing(request.user))

    @transaction.atomic
    def put(self, request):
        coach_only(request)
        serializer = WindowSerializer(data=require_object_body(request).get('windows'), many=True)
        serializer.is_valid(raise_exception=True)
        windows = sorted(serializer.validated_data, key=lambda w: (w['weekday'], w['start']))
        for weekday in range(7):
            day = [w for w in windows if w['weekday'] == weekday]
            if len(day) > MAX_WINDOWS_PER_DAY:
                raise ValidationError({'windows': _('At most three time ranges per day.')})
            if any(a['end'] > b['start'] for a, b in zip(day, day[1:])):
                raise ValidationError({'windows': _('Time ranges of one day must not overlap.')})
        WorkingHours.objects.filter(coach=request.user).delete()
        WorkingHours.objects.bulk_create([
            WorkingHours(coach=request.user, weekday=w['weekday'], start_time=w['start'], end_time=w['end']) for w in windows
        ])
        return Response(self.listing(request.user))

    @staticmethod
    def listing(coach):
        return {'windows': [
            {'weekday': h.weekday, 'start': h.start_time.strftime('%H:%M'), 'end': h.end_time.strftime('%H:%M')}
            for h in WorkingHours.objects.filter(coach=coach)
        ]}


class ExceptionSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=ScheduleException.Kind.choices)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    note = serializers.CharField(max_length=120, required=False, allow_blank=True, default='', trim_whitespace=True)

    def validate(self, data):
        if data['ends_at'] <= data['starts_at']:
            raise serializers.ValidationError({'ends_at': _('The end must be after the start.')})
        if data['ends_at'] - data['starts_at'] > timedelta(days=31):
            raise serializers.ValidationError({'ends_at': _('At most 31 days at once.')})
        if data['ends_at'] <= timezone.now():
            raise serializers.ValidationError({'ends_at': _('Choose a time in the future.')})
        return data


def exception_summary(e):
    return {'id': str(e.id), 'kind': e.kind, 'starts_at': e.starts_at, 'ends_at': e.ends_at, 'note': e.note}


class ExceptionsView(APIView):
    def get(self, request):
        coach_only(request)
        rows = ScheduleException.objects.filter(coach=request.user, ends_at__gt=timezone.now())[:100]
        return Response([exception_summary(e) for e in rows])

    def post(self, request):
        coach_only(request)
        serializer = ExceptionSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        item = ScheduleException.objects.create(coach=request.user, **data)
        # Closing time does not cancel anything by itself: the coach sees what is booked then.
        conflicts = Booking.objects.filter(
            coach=request.user, status__in=Booking.HOLDS_TIME, starts_at__lt=item.ends_at, ends_at__gt=item.starts_at,
        ).select_related('session_type', 'coach__profile', 'client__profile') if item.kind == ScheduleException.Kind.CLOSED else []
        return Response({**exception_summary(item), 'conflicts': [booking_summary(b, viewer=request.user) for b in conflicts]},
                        status=status.HTTP_201_CREATED)


class ExceptionView(APIView):
    def delete(self, request, pk):
        coach_only(request)
        deleted, _rows = ScheduleException.objects.filter(pk=pk, coach=request.user).delete()
        if not deleted:
            raise NotFound()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CalendarView(APIView):
    """The coach's bookings and exceptions between two local dates, with his working hours."""

    def get(self, request):
        coach_only(request)
        first, last = date_range(request)
        start, end = local_bounds(first, last)
        rows = (Booking.objects.filter(coach=request.user, starts_at__lt=end, ends_at__gt=start)
                .exclude(status=Booking.Status.DECLINED).select_related('session_type', 'coach__profile', 'client__profile'))
        exceptions = ScheduleException.objects.filter(coach=request.user, starts_at__lt=end, ends_at__gt=start)
        now = timezone.now()
        return Response({
            'from': first, 'to': last,
            'bookings': [booking_summary(b, viewer=request.user, now=now) for b in rows],
            'exceptions': [exception_summary(e) for e in exceptions],
            'hours': HoursView.listing(request.user)['windows'],
            'requests': Booking.objects.filter(coach=request.user, status=Booking.Status.REQUESTED, starts_at__gt=now).count(),
        })


# ---- booking (both sides) -------------------------------------------------------------------

class SlotsView(APIView):
    """The client's free start times for one session type of his coach."""

    def get(self, request):
        connection = client_connection(request)
        coach = connection.coach
        types = SessionType.objects.filter(coach=coach, archived_at__isnull=True)
        first, last = date_range(request)
        type_id = request.query_params.get('session_type')
        chosen = types.filter(pk=type_id).first() if type_id else types.first()
        if type_id and chosen is None:
            raise ValidationError({'session_type': _('Choose one of the coach\'s session types.')})
        now = timezone.now()
        rules = booking_settings(coach)
        return Response({
            'coach': {'id': str(coach.id), 'name': display_name(coach)},
            'connection_id': str(connection.id),
            'session_types': [session_type_summary(t) for t in types],
            'session_type_id': str(chosen.id) if chosen else None,
            'auto_confirm': rules.auto_confirm, 'cancel_hours': rules.cancel_hours,
            'slots': free_slots(coach, chosen, first, last, now=now, client=request.user) if chosen else [],
        })


class BookingCreateSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    session_type_id = serializers.UUIDField()
    starts_at = serializers.DateTimeField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default='', trim_whitespace=True)
    # The coach books for one of his clients (the collaboration he chose).
    connection_id = serializers.UUIDField(required=False)


class BookingsView(APIView):
    def get(self, request):
        """The client's sessions: upcoming ones and the last few."""
        client_only(request)
        now = timezone.now()
        rows = Booking.objects.filter(client=request.user).select_related('session_type', 'coach__profile', 'client__profile')
        upcoming = rows.filter(ends_at__gt=now).exclude(status=Booking.Status.DECLINED, starts_at__lt=now - timedelta(days=7))
        past = rows.filter(ends_at__lte=now).order_by('-starts_at')[:10]
        return Response({
            'upcoming': [booking_summary(b, viewer=request.user, now=now) for b in upcoming[:50]],
            'past': [booking_summary(b, viewer=request.user, now=now) for b in past],
        })

    def post(self, request):
        serializer = BookingCreateSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if request.user.profile.is_coach:
            if not data.get('connection_id'):
                raise ValidationError({'connection_id': 'Choose the client.'})
            connection = CoachConnection.objects.filter(pk=data['connection_id'], coach=request.user, ended_at__isnull=True).first()
            if connection is None:
                from coaching.errors import CollaborationChanged

                raise CollaborationChanged()
            by = Booking.By.COACH
        else:
            connection = client_connection(request)
            by = Booking.By.CLIENT
        starts_at = data['starts_at'].replace(second=0, microsecond=0)
        booking, created = services.create_booking(
            by=by, connection_id=connection.pk, session_type_id=data['session_type_id'], starts_at=starts_at,
            note=data['note'], booking_id=data.get('id'),
        )
        booking = Booking.objects.select_related('session_type', 'coach__profile', 'client__profile').get(pk=booking.pk)
        return Response(booking_summary(booking, viewer=request.user), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default='', trim_whitespace=True)


class BookingActionView(APIView):
    action = None

    def post(self, request, pk):
        serializer = ReasonSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data['reason']
        if self.action == 'confirm':
            services.confirm(pk, user=request.user)
        elif self.action == 'decline':
            services.decline(pk, user=request.user, reason=reason)
        else:
            services.cancel(pk, user=request.user, reason=reason)
        booking = Booking.objects.select_related('session_type', 'coach__profile', 'client__profile').get(pk=pk)
        return Response(booking_summary(booking, viewer=request.user))


def today_counts(coach, now=None):
    """For the coach's overview: sessions today, and requests waiting for an answer."""
    now = now or timezone.now()
    start, end = local_bounds(timezone.localdate(now), timezone.localdate(now))
    held = Booking.objects.filter(coach=coach, status__in=Booking.HOLDS_TIME)
    return {
        'bookings_today': held.filter(starts_at__gte=start, starts_at__lt=end).count(),
        'booking_requests': held.filter(Q(status=Booking.Status.REQUESTED), starts_at__gt=now).count(),
    }
