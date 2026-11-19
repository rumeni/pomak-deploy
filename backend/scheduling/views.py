from datetime import date, timedelta
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from coaching.errors import CollaborationChanged
from coaching.models import CoachConnection
from coaching.views import access_facts, client_only, coach_only, display_name
from core.views import require_object_body

from . import services
from .availability import SCHEDULE_TIME_ZONE, booking_settings, day_bounds, free_slots, lock_schedule
from .models import Booking, BookingSettings, ScheduleException, SessionPackage, SessionType, WorkingHours

MAX_RANGE_DAYS = 42
MAX_WINDOWS_PER_DAY = 3


# ---- shapes ---------------------------------------------------------------------------------

def session_type_summary(t):
    return {'id': str(t.id), 'name': t.name, 'duration_minutes': t.duration_minutes, 'mode': t.mode,
            'archived': t.archived_at is not None}


def booking_summary(b, *, viewer, now=None):
    """What was agreed (the type as it was when booked), and what this viewer may do with it."""
    now = now or timezone.now()
    is_coach = viewer.pk == b.coach_id
    return {
        'id': str(b.id), 'starts_at': b.starts_at, 'ends_at': b.ends_at, 'status': b.status,
        # A request nobody answered before its time is no longer actionable.
        'expired': b.status == Booking.Status.REQUESTED and b.starts_at <= now,
        'session_type': {'id': str(b.session_type_id) if b.session_type_id else None, 'name': b.type_name,
                         'duration_minutes': int((b.ends_at - b.starts_at).total_seconds() // 60), 'mode': b.type_mode},
        'coach': {'id': str(b.coach_id), 'name': display_name(b.coach)},
        'client': {'id': str(b.client_id), 'name': display_name(b.client)},
        'connection_id': str(b.connection_id), 'note': b.note, 'created_by': b.created_by,
        'cancelled_by': b.cancelled_by or None, 'cancel_reason': b.cancel_reason,
        'package': {'id': str(b.package_id), 'name': b.package.name} if b.package_id else None,
        'charged': b.charged,
        'can_cancel': (b.status in Booking.HOLDS_TIME and b.ends_at > now) if is_coach else services.can_client_cancel(b, now),
    }


def bookings_query():
    return Booking.objects.select_related('coach__profile', 'client__profile', 'package')


def settings_summary(rules):
    return {'auto_confirm': rules.auto_confirm, 'cancel_hours': rules.cancel_hours, 'min_notice_hours': rules.min_notice_hours,
            'horizon_days': rules.horizon_days, 'slot_step_minutes': rules.slot_step_minutes}


def date_range(request, *, default_days=7):
    """`from` / `to` schedule dates (inclusive), at most six weeks, in a sane year range."""
    try:
        first = date.fromisoformat(request.query_params['from']) if request.query_params.get('from') else timezone.localdate()
        last = date.fromisoformat(request.query_params['to']) if request.query_params.get('to') else first + timedelta(days=default_days - 1)
    except (ValueError, OverflowError):
        raise ValidationError({'from': 'Use YYYY-MM-DD dates.'}) from None
    if not (2000 <= first.year <= 2100 and 2000 <= last.year <= 2100):
        raise ValidationError({'from': 'Dates between 2000 and 2100.'})
    if last < first or (last - first).days >= MAX_RANGE_DAYS:
        raise ValidationError({'to': f'A range of 1 to {MAX_RANGE_DAYS} days.'})
    return first, last


def client_connection(request):
    client_only(request)
    connection = CoachConnection.objects.filter(client=request.user, ended_at__isnull=True).select_related('coach__profile').first()
    if connection is None:
        raise NotFound({'detail': _('You have no coach at the moment.'), 'code': 'no_coach'})
    return connection


def coach_setup(request):
    """A configuration change: one at a time per coach, never while a booking is being checked."""
    coach_only(request)
    lock_schedule(request.user.pk)


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

    @transaction.atomic
    def put(self, request):
        serializer = SettingsSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        coach_setup(request)
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

    @transaction.atomic
    def post(self, request):
        serializer = SessionTypeSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        coach_setup(request)
        if SessionType.objects.filter(coach=request.user, archived_at__isnull=True).count() >= 20:
            raise ValidationError({'name': _('At most 20 session types.')})
        item = SessionType.objects.create(coach=request.user, **serializer.validated_data)
        return Response(session_type_summary(item), status=status.HTTP_201_CREATED)


class SessionTypeView(APIView):
    def item(self, request, pk):
        coach_setup(request)
        item = SessionType.objects.filter(pk=pk, coach=request.user, archived_at__isnull=True).first()
        if item is None:
            raise NotFound()
        return item

    @transaction.atomic
    def put(self, request, pk):
        serializer = SessionTypeSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        item = self.item(request, pk)
        # Only new bookings use the change: booked sessions keep their own copy of the type.
        for field, value in serializer.validated_data.items():
            setattr(item, field, value)
        item.save()
        return Response(session_type_summary(item))

    @transaction.atomic
    def delete(self, request, pk):
        item = self.item(request, pk)
        item.archived_at = timezone.now()
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
    """The weekly working hours (schedule time zone), replaced as a whole."""

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
        coach_setup(request)
        WorkingHours.objects.filter(coach=request.user).delete()
        WorkingHours.objects.bulk_create([
            WorkingHours(coach=request.user, weekday=w['weekday'], start_time=w['start'], end_time=w['end']) for w in windows
        ])
        return Response(self.listing(request.user))

    @staticmethod
    def listing(coach):
        return {'time_zone': SCHEDULE_TIME_ZONE, 'windows': [
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

    @transaction.atomic
    def post(self, request):
        serializer = ExceptionSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        coach_setup(request)  # after this, no booking is half-way: the conflicts list is complete
        item = ScheduleException.objects.create(coach=request.user, **serializer.validated_data)
        # Closing time does not cancel anything by itself: the coach sees what is booked then.
        conflicts = bookings_query().filter(
            coach=request.user, status__in=Booking.HOLDS_TIME, starts_at__lt=item.ends_at, ends_at__gt=item.starts_at,
        ) if item.kind == ScheduleException.Kind.CLOSED else []
        return Response({**exception_summary(item), 'conflicts': [booking_summary(b, viewer=request.user) for b in conflicts]},
                        status=status.HTTP_201_CREATED)


class ExceptionView(APIView):
    @transaction.atomic
    def delete(self, request, pk):
        coach_setup(request)
        deleted, _rows = ScheduleException.objects.filter(pk=pk, coach=request.user).delete()
        if not deleted:
            raise NotFound()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CalendarView(APIView):
    """The coach's bookings and exceptions overlapping these schedule days, with his hours."""

    def get(self, request):
        coach_only(request)
        first, last = date_range(request)
        start, end = day_bounds(first, last)
        rows = (bookings_query().filter(coach=request.user, starts_at__lt=end, ends_at__gt=start)
                .exclude(status=Booking.Status.DECLINED))
        exceptions = ScheduleException.objects.filter(coach=request.user, starts_at__lt=end, ends_at__gt=start)
        now = timezone.now()
        return Response({
            'from': first, 'to': last, 'time_zone': SCHEDULE_TIME_ZONE,
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
        if type_id:
            try:
                UUID(type_id)
            except ValueError:
                raise ValidationError({'session_type': _("Choose one of the coach's session types.")}) from None
        chosen = types.filter(pk=type_id).first() if type_id else types.first()
        if type_id and chosen is None:
            raise ValidationError({'session_type': _("Choose one of the coach's session types.")})
        now = timezone.now()
        rules = booking_settings(coach)
        return Response({
            'coach': {'id': str(coach.id), 'name': display_name(coach)},
            # The collaboration these slots are for: the booking names it.
            'connection_id': str(connection.id),
            'time_zone': SCHEDULE_TIME_ZONE,
            'session_types': [session_type_summary(t) for t in types],
            'session_type_id': str(chosen.id) if chosen else None,
            'auto_confirm': rules.auto_confirm, 'cancel_hours': rules.cancel_hours,
            'slots': free_slots(coach, chosen.duration_minutes, first, last, now=now, client=request.user) if chosen else [],
        })


class BookingCreateSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    session_type_id = serializers.UUIDField()
    starts_at = serializers.DateTimeField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default='', trim_whitespace=True)
    # The collaboration the form was made for (the coach's chosen client, or the client's slots).
    connection_id = serializers.UUIDField()


class BookingsView(APIView):
    def get(self, request):
        """The client's sessions: upcoming ones that still stand, recent outcomes, the last few."""
        client_only(request)
        now = timezone.now()
        rows = bookings_query().filter(client=request.user)
        upcoming = rows.filter(status__in=Booking.HOLDS_TIME, ends_at__gt=now)[:50]
        recent = (rows.filter(status__in=[Booking.Status.DECLINED, Booking.Status.CANCELLED],
                              updated_at__gte=now - timedelta(days=14), starts_at__gt=now - timedelta(days=1))
                  .order_by('-updated_at')[:10])
        past = rows.filter(status=Booking.Status.CONFIRMED, ends_at__lte=now).order_by('-starts_at')[:10]
        return Response({
            'upcoming': [booking_summary(b, viewer=request.user, now=now) for b in upcoming],
            'recent': [booking_summary(b, viewer=request.user, now=now) for b in recent],
            'past': [booking_summary(b, viewer=request.user, now=now) for b in past],
        })

    def post(self, request):
        serializer = BookingCreateSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        by = Booking.By.COACH if request.user.profile.is_coach else Booking.By.CLIENT
        booking, created = services.create_booking(
            user=request.user, by=by, connection_id=data['connection_id'], session_type_id=data['session_type_id'],
            starts_at=data['starts_at'], note=data['note'], booking_id=data.get('id'),
        )
        booking = bookings_query().get(pk=booking.pk)
        return Response(booking_summary(booking, viewer=request.user), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ActionSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default='', trim_whitespace=True)
    # The coach cancelling late: the session still uses the client's package.
    charge = serializers.BooleanField(required=False, default=False)


class BookingActionView(APIView):
    action = None

    def post(self, request, pk):
        serializer = ActionSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if self.action == 'confirm':
            services.confirm(pk, user=request.user)
        elif self.action == 'decline':
            services.decline(pk, user=request.user, reason=data['reason'])
        else:
            services.cancel(pk, user=request.user, reason=data['reason'], charge=data['charge'])
        return Response(booking_summary(bookings_query().get(pk=pk), viewer=request.user))


# ---- packages -------------------------------------------------------------------------------

class PackageSerializer(serializers.Serializer):
    # Made by the app and kept across a retry: a lost answer never creates a second package.
    id = serializers.UUIDField()
    connection_id = serializers.UUIDField()
    name = serializers.CharField(max_length=80, trim_whitespace=True)
    total = serializers.IntegerField(min_value=1, max_value=200)
    valid_from = serializers.DateField()
    expires_on = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default='', trim_whitespace=True)

    def validate(self, data):
        if data.get('expires_on') and data['expires_on'] < data['valid_from']:
            raise serializers.ValidationError({'expires_on': _('The end must be after the start.')})
        return data


class PackageChangeSerializer(serializers.Serializer):
    connection_id = serializers.UUIDField()
    # The correction as a whole value (+ sessions used outside the calendar, - given back), with
    # the value the coach saw: a retry cannot apply it twice, a concurrent change is refused.
    adjustment = serializers.IntegerField(min_value=-200, max_value=200, required=False)
    expected_adjustment = serializers.IntegerField(min_value=-200, max_value=200, required=False)
    expires_on = serializers.DateField(required=False, allow_null=True)
    close = serializers.BooleanField(required=False, default=False)

    def validate(self, data):
        if ('adjustment' in data) != ('expected_adjustment' in data):
            raise serializers.ValidationError({'expected_adjustment': 'Send both the new and the seen correction.'})
        return data


class PackageChanged(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({'detail': _('This package has changed. Reload and try again.'), 'code': 'package_changed'})


def _coach_connection(request, client_id, connection_id):
    """The coach's active collaboration with this client, locked, and exactly the expected one."""
    coach_only(request)
    connection = CoachConnection.objects.select_for_update().filter(coach=request.user, client_id=client_id, ended_at__isnull=True).first()
    if connection is None or connection.pk != connection_id:
        raise CollaborationChanged()
    return connection


class ClientPackagesView(APIView):
    """A client's packages, for his coach."""

    def get(self, request, client_id):
        coach_only(request)
        connection = CoachConnection.objects.filter(coach=request.user, client_id=client_id, ended_at__isnull=True).first()
        if connection is None:
            raise NotFound()
        return Response(self.listing(connection))

    @transaction.atomic
    def post(self, request, client_id):
        serializer = PackageSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        connection = _coach_connection(request, client_id, data.pop('connection_id'))
        package_id = data.pop('id')
        existing = SessionPackage.objects.filter(pk=package_id).first()
        if existing is not None:
            same = (existing.connection_id == connection.pk and existing.name == data['name'] and existing.total == data['total']
                    and existing.valid_from == data['valid_from'] and existing.expires_on == data.get('expires_on')
                    and existing.note == data['note'])
            if not same:
                raise ValidationError({'id': 'This package ID is already in use for another request.'})
            return Response(self.listing(connection))
        try:
            with transaction.atomic():
                SessionPackage.objects.create(id=package_id, coach=request.user, client_id=client_id, connection=connection, **data)
        except IntegrityError:
            # The same ID taken at this very moment (by another collaboration): a clear refusal.
            raise ValidationError({'id': 'This package ID is already in use for another request.'}) from None
        return Response(self.listing(connection), status=status.HTTP_201_CREATED)

    @staticmethod
    def listing(connection):
        return {'access': access_facts(connection), 'connection_id': str(connection.id),
                'packages': [services.package_summary(p) for p in packages_in_order(connection)]}


class PackageView(APIView):
    @transaction.atomic
    def patch(self, request, client_id, pk):
        serializer = PackageChangeSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        connection = _coach_connection(request, client_id, data['connection_id'])
        package = SessionPackage.objects.select_for_update().filter(pk=pk, connection=connection).first()
        if package is None:
            raise NotFound()
        if 'adjustment' in data and package.adjustment != data['adjustment']:
            if package.adjustment != data['expected_adjustment']:
                raise PackageChanged()
            used = services.counted(package) + data['adjustment']
            if not 0 <= used <= package.total:
                raise ValidationError({'adjustment': _('Used sessions must stay between 0 and the package total.')})
            package.adjustment = data['adjustment']
        if 'expires_on' in request.data:
            if data['expires_on'] and data['expires_on'] < package.valid_from:
                raise ValidationError({'expires_on': _('The end must be after the start.')})
            package.expires_on = data['expires_on']
        if data['close']:
            package.closed_at = package.closed_at or timezone.now()
        package.save()
        return Response(ClientPackagesView.listing(connection))


class MyPackagesView(APIView):
    """The client's packages with his current coach: what is left and until when."""

    def get(self, request):
        connection = client_connection(request)
        today = timezone.localdate()
        rows = [p for p in packages_in_order(connection) if p.closed_at is None and not (p.expires_on and p.expires_on < today)]
        # Which collaboration these belong to: the app shows them only for its current one.
        return Response({'connection_id': str(connection.id), 'packages': [services.package_summary(p) for p in rows]})


def packages_in_order(connection):
    """Packages in use first (open, not expired), then the last ten others."""
    today = timezone.localdate()
    rows = list(SessionPackage.objects.filter(connection=connection).order_by('-valid_from', '-created_at'))
    active = [p for p in rows if p.closed_at is None and not (p.expires_on and p.expires_on < today)]
    return active + [p for p in rows if p not in active][:10]


def today_counts(coach, now=None):
    """For the coach's overview: sessions today, and requests waiting for an answer."""
    now = now or timezone.now()
    start, end = day_bounds(timezone.localdate(now), timezone.localdate(now))
    held = Booking.objects.filter(coach=coach, status__in=Booking.HOLDS_TIME)
    return {
        'bookings_today': held.filter(starts_at__gte=start, starts_at__lt=end).count(),
        'booking_requests': held.filter(status=Booking.Status.REQUESTED, starts_at__gt=now).count(),
    }
