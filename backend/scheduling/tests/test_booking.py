"""Calendar and booking (T4): free slots, booking rules, the database overlap guard, consistency
with configuration changes, time zones, history, packages and reminders."""

import threading
import time as clock
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from unittest import mock
from uuid import uuid4

from django.db import IntegrityError, connections, transaction
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase, APITransactionTestCase

from accounts.models import User
from coaching.models import CoachConnection
from scheduling import services
from scheduling.availability import LOCAL, free_slots
from scheduling.models import Booking, BookingReminder, BookingSettings, ScheduleException, SessionPackage, SessionType, WorkingHours

UTC = dt_timezone.utc


def make_user(email, *, coach=False):
    user = User.objects.create_user(email, 'a-strong-secret')
    user.profile.is_coach = coach
    user.profile.save()
    return user


def at(days, hour, minute=0):
    """A schedule-zone time `days` from today."""
    day = timezone.localdate() + timedelta(days=days)
    return datetime.combine(day, time(hour, minute), LOCAL)


class BookingTestCase(APITestCase):
    def setUp(self):
        self.coach = make_user('cal-coach@example.test', coach=True)
        self.other_coach = make_user('cal-other-coach@example.test', coach=True)
        self.ana = make_user('cal-ana@example.test')
        self.ben = make_user('cal-ben@example.test')
        self.stranger = make_user('cal-stranger@example.test')
        self.ana_link = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.ben_link = CoachConnection.objects.create(coach=self.coach, client=self.ben)
        self.stranger_link = CoachConnection.objects.create(coach=self.other_coach, client=self.stranger)
        self.pt = SessionType.objects.create(coach=self.coach, name='Personalni trening', duration_minutes=60)
        for weekday in range(7):
            WorkingHours.objects.create(coach=self.coach, weekday=weekday, start_time=time(8), end_time=time(12))

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def link_of(self, user):
        return CoachConnection.objects.filter(client=user, ended_at__isnull=True).first() or CoachConnection.objects.filter(client=user).last()

    def book(self, user, starts_at, client=None, **body):
        """As the app does: the collaboration the form was opened for."""
        self.as_user(user)
        connection = self.link_of(client or user)
        return self.client.post('/api/schedule/bookings/', {
            'session_type_id': str(self.pt.pk), 'starts_at': starts_at.isoformat(), 'connection_id': str(connection.pk), **body,
        }, format='json')

    def slots(self, user=None, days=2):
        self.as_user(user or self.ana)
        day = (timezone.localdate() + timedelta(days=days)).isoformat()
        data = self.client.get(f'/api/schedule/slots/?from={day}&to={day}').data
        return [s.astimezone(LOCAL).strftime('%H:%M') for s in data['slots']]


class SlotTests(BookingTestCase):
    def test_working_hours_minus_closed_time_plus_extra_time_minus_bookings(self):
        self.assertEqual(self.slots(), ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00'])
        ScheduleException.objects.create(coach=self.coach, kind='closed', starts_at=at(2, 9), ends_at=at(2, 10))
        ScheduleException.objects.create(coach=self.coach, kind='open', starts_at=at(2, 13), ends_at=at(2, 14))
        self.assertEqual(self.slots(), ['08:00', '10:00', '10:30', '11:00', '13:00'])
        self.assertEqual(self.book(self.ben, at(2, 10)).status_code, 201)
        self.assertEqual(self.slots(), ['08:00', '11:00', '13:00'])

    def test_notice_horizon_and_bad_input(self):
        BookingSettings.objects.create(coach=self.coach, horizon_days=3, min_notice_hours=0)
        self.assertEqual(self.slots(days=5), [])
        self.assertTrue(self.slots(days=2))
        self.as_user(self.ana)
        self.assertEqual(self.client.get('/api/schedule/slots/?session_type=not-a-uuid').status_code, 400)
        self.assertEqual(self.client.get('/api/schedule/slots/?from=9999-12-31&to=9999-12-31').status_code, 400)
        self.assertEqual(self.client.get('/api/schedule/slots/?from=2026-13-01').status_code, 400)

    def test_open_time_across_midnight_is_offered_and_bookable_the_same_way(self):
        BookingSettings.objects.create(coach=self.coach, min_notice_hours=0)
        ScheduleException.objects.create(coach=self.coach, kind='open', starts_at=at(2, 23), ends_at=at(3, 1))
        self.assertIn('23:30', self.slots(days=2))
        self.assertEqual(self.book(self.ana, at(2, 23, 30)).status_code, 201)  # runs past midnight

    def test_a_client_without_a_coach_has_no_slots(self):
        self.as_user(make_user('cal-alone@example.test'))
        response = self.client.get('/api/schedule/slots/')
        self.assertEqual((response.status_code, response.data['code']), (404, 'no_coach'))


class BookingRulesTests(BookingTestCase):
    def test_a_free_slot_is_booked_at_once_and_a_retry_does_not_book_twice(self):
        booking_id = str(uuid4())
        with mock.patch('scheduling.services.notify') as notify:
            response = self.book(self.ana, at(2, 9), id=booking_id, note='Kolena')
        self.assertEqual((response.status_code, response.data['status']), (201, 'confirmed'))
        self.assertEqual(notify.call_args.args[0], self.coach)
        self.assertEqual(self.book(self.ana, at(2, 9), id=booking_id, note='Kolena').status_code, 200)  # lost answer, retried
        self.assertEqual(self.book(self.ana, at(2, 9), id=booking_id, note='Leđa').status_code, 400)  # same ID, other note
        self.assertEqual(self.book(self.ana, at(2, 10), id=booking_id, note='Kolena').status_code, 400)
        self.assertEqual(Booking.objects.count(), 1)

    def test_only_free_slots_for_clients(self):
        for starts_at in (at(2, 7), at(2, 11, 30), at(2, 8, 10), timezone.now() + timedelta(minutes=30), at(40, 9)):
            response = self.book(self.ana, starts_at)
            self.assertIn(response.status_code, (400, 409), starts_at)
        self.assertFalse(Booking.objects.exists())

    def test_a_form_made_for_an_ended_collaboration_never_books_into_a_new_one(self):
        stale = str(self.ana_link.pk)
        CoachConnection.objects.filter(pk=self.ana_link.pk).update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.coach, client=self.ana)  # reconnected meanwhile
        self.as_user(self.ana)
        response = self.client.post('/api/schedule/bookings/', {
            'session_type_id': str(self.pt.pk), 'starts_at': at(2, 9).isoformat(), 'connection_id': stale}, format='json')
        self.assertEqual((response.status_code, response.data['code']), (409, 'collaboration_changed'))
        self.assertFalse(Booking.objects.exists())
        # Someone else's collaboration is refused the same way.
        response = self.client.post('/api/schedule/bookings/', {
            'session_type_id': str(self.pt.pk), 'starts_at': at(2, 9).isoformat(), 'connection_id': str(self.ben_link.pk)}, format='json')
        self.assertEqual(response.status_code, 409)

    def test_manual_confirmation(self):
        BookingSettings.objects.create(coach=self.coach, auto_confirm=False)
        first = self.book(self.ana, at(2, 9)).data
        second = self.book(self.ben, at(2, 11)).data
        self.assertEqual((first['status'], second['status']), ('requested', 'requested'))
        # A request holds its time: nobody else can take it meanwhile.
        self.assertEqual(self.book(self.ben, at(2, 9)).status_code, 409)
        self.as_user(self.coach)
        self.assertEqual(self.client.post(f"/api/schedule/bookings/{first['id']}/confirm/", {}, format='json').data['status'], 'confirmed')
        self.assertEqual(self.client.post(f"/api/schedule/bookings/{second['id']}/decline/", {'reason': 'Bolestan'}, format='json').data['status'], 'declined')
        self.assertEqual(self.book(self.ana, at(2, 11)).status_code, 201)  # declined frees the time
        self.as_user(self.coach)
        self.assertEqual(self.client.post(f"/api/schedule/bookings/{second['id']}/confirm/", {}, format='json').status_code, 409)

    def test_cancel_deadline_for_clients_not_for_the_coach(self):
        BookingSettings.objects.create(coach=self.coach, cancel_hours=72, min_notice_hours=0)
        booking = self.book(self.ana, at(2, 9)).data
        self.assertFalse(booking['can_cancel'])
        self.as_user(self.ana)
        late = self.client.post(f"/api/schedule/bookings/{booking['id']}/cancel/", {}, format='json')
        self.assertEqual((late.status_code, late.data['code']), (409, 'booking_changed'))
        self.as_user(self.coach)
        self.assertEqual(self.client.post(f"/api/schedule/bookings/{booking['id']}/cancel/", {'reason': 'Sprečen'}, format='json').data['status'], 'cancelled')
        self.assertEqual(self.book(self.ben, at(2, 9)).status_code, 201)  # cancelled frees the time

    def test_the_coach_books_any_time_for_his_own_active_clients(self):
        response = self.book(self.coach, at(3, 18), client=self.ana)
        self.assertEqual((response.status_code, response.data['status'], response.data['created_by']), (201, 'confirmed', 'coach'))
        self.as_user(self.coach)
        for connection in (self.stranger_link, ):
            response = self.client.post('/api/schedule/bookings/', {'session_type_id': str(self.pt.pk), 'starts_at': at(3, 9).isoformat(),
                                                                     'connection_id': str(connection.pk)}, format='json')
            self.assertEqual(response.status_code, 409)
        CoachConnection.objects.filter(pk=self.ben_link.pk).update(ended_at=timezone.now())
        response = self.client.post('/api/schedule/bookings/', {'session_type_id': str(self.pt.pk), 'starts_at': at(3, 9).isoformat(),
                                                                 'connection_id': str(self.ben_link.pk)}, format='json')
        self.assertEqual(response.status_code, 409)

    def test_permissions(self):
        booking = self.book(self.ana, at(2, 9)).data
        for user in (self.ben, self.stranger, self.other_coach):
            self.as_user(user)
            self.assertEqual(self.client.post(f"/api/schedule/bookings/{booking['id']}/cancel/", {}, format='json').status_code, 404)
        self.as_user(self.ana)
        self.assertEqual(self.client.post(f"/api/schedule/bookings/{booking['id']}/confirm/", {}, format='json').status_code, 404)
        self.assertEqual(self.client.get('/api/schedule/calendar/').status_code, 403)
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get('/api/schedule/calendar/').data['bookings'], [])
        self.as_user(self.ben)
        self.assertEqual(self.client.get('/api/schedule/bookings/').data['upcoming'], [])

    def test_ending_the_collaboration_cancels_future_sessions(self):
        booking = self.book(self.ana, at(2, 9)).data
        self.as_user(self.ana)
        self.client.delete('/api/coach/connection/', {}, format='json')
        stored = Booking.objects.get(pk=booking['id'])
        self.assertEqual((stored.status, stored.cancelled_by), ('cancelled', 'system'))

    def test_upcoming_sessions_are_not_hidden_by_old_outcomes(self):
        BookingSettings.objects.create(coach=self.coach, auto_confirm=False)
        for hour in (8, 9, 10):
            booking = self.book(self.ana, at(2, hour)).data
            self.as_user(self.coach)
            self.client.post(f"/api/schedule/bookings/{booking['id']}/decline/", {}, format='json')
        kept = self.book(self.ana, at(3, 9)).data
        self.as_user(self.ana)
        data = self.client.get('/api/schedule/bookings/').data
        self.assertEqual([b['id'] for b in data['upcoming']], [kept['id']])
        self.assertEqual(len(data['recent']), 3)

    def test_the_coach_sees_his_calendar_and_counts(self):
        BookingSettings.objects.create(coach=self.coach, auto_confirm=False)
        self.book(self.ana, at(2, 9))
        self.as_user(self.coach)
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        data = self.client.get(f'/api/schedule/calendar/?from={day}&to={day}').data
        self.assertEqual([(b['client']['name'], b['status']) for b in data['bookings']], [('cal-ana', 'requested')])
        self.assertEqual((data['requests'], data['time_zone']), (1, 'Europe/Belgrade'))
        self.assertEqual(self.client.get('/api/coach/dashboard/').data['booking_requests'], 1)

    def test_a_multi_day_exception_starting_before_the_week_is_in_the_calendar(self):
        ScheduleException.objects.create(coach=self.coach, kind='closed', starts_at=at(-3, 0), ends_at=at(4, 0), note='Odmor')
        self.as_user(self.coach)
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        self.assertEqual(len(self.client.get(f'/api/schedule/calendar/?from={day}&to={day}').data['exceptions']), 1)


class HistoryTests(BookingTestCase):
    def test_editing_or_removing_a_type_never_rewrites_booked_sessions(self):
        booking = self.book(self.ana, at(2, 9)).data
        self.as_user(self.coach)
        self.client.put(f'/api/schedule/session-types/{self.pt.pk}/', {'name': 'Online konsultacija', 'duration_minutes': 30, 'mode': 'online'}, format='json')
        self.client.delete(f'/api/schedule/session-types/{self.pt.pk}/')
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        stored = self.client.get(f'/api/schedule/calendar/?from={day}&to={day}').data['bookings'][0]
        self.assertEqual((stored['id'], stored['session_type']['name'], stored['session_type']['duration_minutes'], stored['session_type']['mode']),
                         (booking['id'], 'Personalni trening', 60, 'in_person'))

    def test_deleting_an_account_with_sessions_works_and_leaves_others_intact(self):
        self.book(self.ana, at(2, 9))
        cancelled = self.book(self.ben, at(2, 10)).data
        self.as_user(self.coach)
        self.client.post(f"/api/schedule/bookings/{cancelled['id']}/cancel/", {}, format='json')
        other_type = SessionType.objects.create(coach=self.other_coach, name='PT', duration_minutes=60)
        Booking.objects.create(coach=self.other_coach, client=self.stranger, connection=self.stranger_link, session_type=other_type,
                               type_name='PT', type_mode='in_person', starts_at=at(-5, 9), ends_at=at(-5, 10), status='confirmed', created_by='coach')
        self.as_user(self.ana)
        self.assertEqual(self.client.post('/api/auth/me/delete/', {'password': 'a-strong-secret'}, format='json').status_code, 204)
        self.as_user(self.coach)
        self.assertEqual(self.client.post('/api/auth/me/delete/', {'password': 'a-strong-secret'}, format='json').status_code, 204)
        self.assertEqual(list(Booking.objects.values_list('client__email', flat=True)), ['cal-stranger@example.test'])
        self.assertTrue(User.objects.filter(email='cal-ben@example.test').exists())


class TimeZoneTests(BookingTestCase):
    """The schedule is in Europe/Belgrade; durations and overlaps are real time across clock changes."""

    def setUp(self):
        super().setUp()
        WorkingHours.objects.filter(coach=self.coach).delete()
        for weekday in range(7):
            WorkingHours.objects.create(coach=self.coach, weekday=weekday, start_time=time(1), end_time=time(5))
        self.long = SessionType.objects.create(coach=self.coach, name='Dugi', duration_minutes=120)
        BookingSettings.objects.create(coach=self.coach, horizon_days=90, min_notice_hours=0, slot_step_minutes=30)

    def test_spring_forward(self):
        day = date(2027, 3, 28)  # 02:00 -> 03:00
        now = datetime(2027, 3, 1, tzinfo=UTC)
        slots = free_slots(self.coach, 120, day, day, now=now)
        local = [s.astimezone(LOCAL).strftime('%H:%M') for s in slots]
        self.assertNotIn('02:00', local)
        self.assertNotIn('02:30', local)
        # 01:00 to 05:00 local is three real hours that day: a 120-minute session fits twice-ish.
        self.assertEqual(local, ['01:00', '01:30', '03:00'])
        with mock.patch('scheduling.services.timezone.now', return_value=now):
            booking, _created = services.create_booking(user=self.ana, by='client', connection_id=self.ana_link.pk,
                                                        session_type_id=self.long.pk, starts_at=slots[0])
        self.assertEqual(booking.ends_at - booking.starts_at, timedelta(minutes=120))  # real minutes
        self.assertEqual(booking.ends_at.astimezone(LOCAL).strftime('%H:%M'), '04:00')

    def test_fall_back(self):
        day = date(2027, 10, 31)  # 03:00 -> 02:00
        now = datetime(2027, 10, 1, tzinfo=UTC)
        slots = free_slots(self.coach, 120, day, day, now=now)
        self.assertEqual(len(slots), len(set(slots)))
        # 01:00 to 05:00 local is five real hours that day.
        self.assertEqual(slots[-1] + timedelta(minutes=120) - slots[0], timedelta(hours=5))


class ConfigurationRaceTests(APITransactionTestCase):
    """A booking's check and insert never interleave with the coach changing his schedule."""

    def setUp(self):
        self.coach = make_user('race-coach@example.test', coach=True)
        self.ana = make_user('race-ana@example.test')
        self.link = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.pt = SessionType.objects.create(coach=self.coach, name='PT', duration_minutes=60)
        for weekday in range(7):
            WorkingHours.objects.create(coach=self.coach, weekday=weekday, start_time=time(8), end_time=time(12))

    def run_both(self, change):
        """The booking passes its availability check, waits; the coach's change runs meanwhile."""
        checked = threading.Event()
        results = {}
        real = services.is_free_slot

        def slow_check(*args, **kwargs):
            ok = real(*args, **kwargs)
            checked.set()
            clock.sleep(0.8)
            return ok

        def book():
            try:
                client = APIClient()
                client.force_authenticate(user=self.ana)
                results['booking'] = client.post('/api/schedule/bookings/', {
                    'session_type_id': str(self.pt.pk), 'starts_at': at(2, 9).isoformat(), 'connection_id': str(self.link.pk)}, format='json')
            finally:
                connections.close_all()

        def coach():
            try:
                checked.wait(10)
                client = APIClient()
                client.force_authenticate(user=self.coach)
                results['change'] = change(client)
            finally:
                connections.close_all()

        with mock.patch('scheduling.services.is_free_slot', side_effect=slow_check):
            threads = [threading.Thread(target=book), threading.Thread(target=coach)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(30)
        return results

    def test_closing_time_sees_a_booking_that_was_being_made(self):
        results = self.run_both(lambda c: c.post('/api/schedule/exceptions/', {
            'kind': 'closed', 'starts_at': at(2, 0).isoformat(), 'ends_at': at(3, 0).isoformat()}, format='json'))
        self.assertEqual(results['booking'].status_code, 201)
        # The closure waited for the booking, so the coach is told about it.
        self.assertEqual(len(results['change'].data['conflicts']), 1)

    def test_archiving_a_type_waits_for_a_booking_being_made(self):
        results = self.run_both(lambda c: c.delete(f'/api/schedule/session-types/{self.pt.pk}/'))
        self.assertEqual((results['booking'].status_code, results['change'].status_code), (201, 204))
        self.assertEqual(Booking.objects.get().type_name, 'PT')

    def test_parallel_hours_replacement_leaves_one_whole_week(self):
        weeks = [[{'weekday': d, 'start': '06:00', 'end': '07:00'} for d in range(7)],
                 [{'weekday': d, 'start': '18:00', 'end': '20:00'} for d in range(7)]]
        results = []

        def put(windows):
            try:
                client = APIClient()
                client.force_authenticate(user=self.coach)
                results.append(client.put('/api/schedule/hours/', {'windows': windows}, format='json').status_code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=put, args=(w,)) for w in weeks]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        self.assertEqual(results, [200, 200])
        starts = set(WorkingHours.objects.filter(coach=self.coach).values_list('start_time', flat=True))
        self.assertEqual(len(starts), 1)
        self.assertEqual(WorkingHours.objects.filter(coach=self.coach).count(), 7)


class DatabaseGuardTests(APITransactionTestCase):
    """The overlap rule holds in the database itself, also for requests at the same moment."""

    def setUp(self):
        self.coach = make_user('guard-coach@example.test', coach=True)
        self.clients = [make_user(f'guard-c{i}@example.test') for i in range(2)]
        self.links = [CoachConnection.objects.create(coach=self.coach, client=c) for c in self.clients]
        self.pt = SessionType.objects.create(coach=self.coach, name='PT', duration_minutes=60)
        for weekday in range(7):
            WorkingHours.objects.create(coach=self.coach, weekday=weekday, start_time=time(8), end_time=time(12))

    def row(self, i, start, end, status='confirmed'):
        return Booking.objects.create(coach=self.coach, client=self.clients[i], connection=self.links[i], session_type=self.pt,
                                      type_name='PT', type_mode='in_person', starts_at=start, ends_at=end, status=status, created_by='client')

    def test_the_database_refuses_an_overlap_even_without_the_application(self):
        self.row(0, at(2, 9), at(2, 10))
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.row(1, at(2, 9, 30), at(2, 10, 30), status='requested')
        self.row(1, at(2, 10), at(2, 11))  # back to back is fine

    def test_two_clients_at_the_same_moment_one_gets_it(self):
        results = []
        start = threading.Barrier(2, timeout=20)

        def book(i):
            try:
                client = APIClient()
                client.force_authenticate(user=self.clients[i])
                start.wait()
                results.append(client.post('/api/schedule/bookings/', {
                    'session_type_id': str(self.pt.pk), 'starts_at': at(2, 9).isoformat(),
                    'connection_id': str(self.links[i].pk)}, format='json').status_code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=book, args=(i,)) for i in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(Booking.objects.count(), 1)


class SlotGridTests(BookingTestCase):
    def test_a_multi_day_open_interval_gives_the_same_slots_for_a_week_and_for_one_day(self):
        BookingSettings.objects.create(coach=self.coach, min_notice_hours=0)
        WorkingHours.objects.filter(coach=self.coach).delete()
        ScheduleException.objects.create(coach=self.coach, kind='open', starts_at=at(2, 10, 10), ends_at=at(6, 18))
        self.as_user(self.ana)
        first = (timezone.localdate() + timedelta(days=2)).isoformat()
        week = self.client.get(f'/api/schedule/slots/?from={first}&to={(timezone.localdate() + timedelta(days=7)).isoformat()}').data['slots']
        day4 = (timezone.localdate() + timedelta(days=4)).isoformat()
        single = self.client.get(f'/api/schedule/slots/?from={day4}&to={day4}').data['slots']
        in_week = [s for s in week if s.astimezone(LOCAL).date().isoformat() == day4]
        self.assertEqual(in_week, single)
        self.assertTrue(all(s.astimezone(LOCAL).minute in (0, 30) for s in week))  # one grid per day
        self.assertEqual(min(week).astimezone(LOCAL).strftime('%H:%M'), '10:30')  # the window started at 10:10
        self.assertEqual(self.book(self.ana, single[3]).status_code, 201)


class PackageTests(BookingTestCase):
    def packages_url(self):
        return f'/api/schedule/clients/{self.ana.pk}/packages/'

    def add_package(self, total=2, package_id=None, **extra):
        self.as_user(self.coach)
        return self.client.post(self.packages_url(), {'id': package_id or str(uuid4()), 'connection_id': str(self.ana_link.pk),
                                                      'name': '12 treninga', 'total': total,
                                                      'valid_from': timezone.localdate().isoformat(), **extra}, format='json')

    def package(self):
        self.as_user(self.coach)
        return self.client.get(self.packages_url()).data['packages'][0]

    def correct(self, package, value, seen=None):
        self.as_user(self.coach)
        return self.client.patch(f"{self.packages_url()}{package['id']}/", {
            'connection_id': str(self.ana_link.pk), 'adjustment': value,
            'expected_adjustment': package['adjustment'] if seen is None else seen}, format='json')

    def test_confirmed_sessions_use_the_package_and_in_time_cancellations_give_them_back(self):
        self.assertEqual(self.add_package(total=2).status_code, 201)
        first = self.book(self.ana, at(2, 9)).data
        self.book(self.ana, at(3, 9))
        self.assertEqual((self.package()['used'], self.package()['remaining']), (2, 0))
        third = self.book(self.ana, at(4, 9)).data
        self.assertIsNone(third['package'])  # nothing left: booked without a package
        self.as_user(self.coach)
        self.client.post(f"/api/schedule/bookings/{first['id']}/cancel/", {}, format='json')
        self.assertEqual(self.package()['remaining'], 1)  # given back

    def test_creating_is_retry_safe(self):
        package_id = str(uuid4())
        self.assertEqual(self.add_package(package_id=package_id).status_code, 201)
        self.assertEqual(self.add_package(package_id=package_id).status_code, 200)  # lost answer, retried
        self.assertEqual(self.add_package(total=5, package_id=package_id).status_code, 400)  # same ID, other content
        self.assertEqual(SessionPackage.objects.count(), 1)

    def test_corrections_are_absolute_bounded_and_refuse_stale_views(self):
        self.add_package(total=12)
        package = self.package()
        self.assertEqual(self.correct(package, 2).status_code, 200)
        self.assertEqual(self.correct(package, 2).status_code, 200)  # the same retry: applied once
        self.assertEqual(self.package()['used'], 2)
        stale = self.correct(package, 5)  # based on the old value 0, but it is 2 now
        self.assertEqual((stale.status_code, stale.data['code']), (409, 'package_changed'))
        fresh = self.package()
        self.assertEqual(self.correct(fresh, -200).status_code, 400)  # used would go below zero
        self.assertEqual(self.correct(fresh, 13).status_code, 400)  # more than the total
        self.assertEqual((self.package()['used'], self.package()['remaining']), (2, 10))

    def test_a_late_cancellation_can_still_count_and_a_refund_never_makes_used_negative(self):
        self.add_package(total=5)
        late = self.book(self.ana, at(2, 9)).data
        self.as_user(self.coach)
        self.client.post(f"/api/schedule/bookings/{late['id']}/cancel/", {'charge': True}, format='json')
        self.assertEqual(self.package()['used'], 1)
        given_back = self.book(self.ana, at(3, 9)).data
        self.correct(self.package(), -2)  # used: 2 sessions - 2 = 0
        self.as_user(self.coach)
        self.client.post(f"/api/schedule/bookings/{given_back['id']}/cancel/", {}, format='json')
        package = self.package()
        self.assertEqual((package['used'], package['remaining']), (0, 5))
        self.as_user(self.ana)
        self.assertEqual(self.client.get('/api/schedule/packages/').data['packages'][0]['remaining'], 5)

    def test_an_expired_or_closed_package_is_not_used(self):
        self.add_package(total=5, expires_on=(timezone.localdate() + timedelta(days=1)).isoformat())
        self.assertIsNone(self.book(self.ana, at(3, 9)).data['package'])  # the session is after it expires
        package_id = self.package()['id']
        self.as_user(self.coach)
        self.client.patch(f'{self.packages_url()}{package_id}/', {'connection_id': str(self.ana_link.pk), 'close': True}, format='json')
        self.assertIsNone(self.book(self.ana, at(1, 10)).data['package'])

    def test_packages_are_bound_to_the_collaboration_and_the_coach(self):
        self.assertIn('access', (self.add_package(), self.client.get(self.packages_url()).data)[1])
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(self.packages_url()).status_code, 404)
        self.assertEqual(self.client.post(self.packages_url(), {'id': str(uuid4()), 'connection_id': str(self.ana_link.pk), 'name': 'X',
                                                                'total': 1, 'valid_from': '2026-01-01'}, format='json').status_code, 409)
        self.as_user(self.ana)
        self.assertEqual(self.client.get(self.packages_url()).status_code, 403)
        self.assertEqual(self.client.get('/api/schedule/packages/').data['connection_id'], str(self.ana_link.pk))
        CoachConnection.objects.filter(pk=self.ana_link.pk).update(ended_at=timezone.now())
        self.assertEqual(self.add_package().status_code, 409)


class ReminderTests(BookingTestCase):
    def test_reminders_before_a_confirmed_session_only_while_it_stands(self):
        booking = self.book(self.ana, at(3, 9)).data
        self.assertEqual(sorted(BookingReminder.objects.values_list('hours_before', flat=True)), [1, 24])
        due = BookingReminder.objects.get(hours_before=24).due_at
        with mock.patch('notifications.push.notify') as notify:
            services.send_due_reminders(now=due - timedelta(minutes=1))
            notify.assert_not_called()
            services.send_due_reminders(now=due + timedelta(minutes=1))
            services.send_due_reminders(now=due + timedelta(minutes=2))  # once
        self.assertEqual(notify.call_count, 1)
        self.assertEqual(notify.call_args.args[0], self.ana)
        self.assertEqual(notify.call_args.kwargs['guard']['kind'], 'booking_reminder')
        self.as_user(self.coach)
        self.client.post(f"/api/schedule/bookings/{booking['id']}/cancel/", {}, format='json')
        one_hour = BookingReminder.objects.get(hours_before=1).due_at
        with mock.patch('notifications.push.notify') as notify:
            services.send_due_reminders(now=one_hour + timedelta(minutes=1))
        notify.assert_not_called()

    def test_a_requested_session_gets_reminders_only_once_confirmed(self):
        BookingSettings.objects.create(coach=self.coach, auto_confirm=False)
        booking = self.book(self.ana, at(3, 9)).data
        self.assertFalse(BookingReminder.objects.exists())
        self.as_user(self.coach)
        self.client.post(f"/api/schedule/bookings/{booking['id']}/confirm/", {}, format='json')
        self.assertEqual(BookingReminder.objects.count(), 2)

    def test_a_stale_reminder_is_not_sent_late(self):
        self.book(self.ana, at(3, 9))
        due = BookingReminder.objects.get(hours_before=24).due_at
        with mock.patch('notifications.push.notify') as notify:
            services.send_due_reminders(now=due + timedelta(hours=3))
        notify.assert_not_called()

    def test_a_queued_reminder_is_dropped_if_the_session_changes_before_sending(self):
        from notifications import push

        booking = self.book(self.ana, at(3, 9)).data
        stored = Booking.objects.get(pk=booking['id'])
        guard = {'kind': 'booking_reminder', 'booking': booking['id'], 'start': stored.starts_at.isoformat()}
        self.assertTrue(push.still_valid({'guard': guard}, timezone.now()))
        self.as_user(self.coach)
        self.client.post(f"/api/schedule/bookings/{booking['id']}/cancel/", {}, format='json')
        self.assertFalse(push.still_valid({'guard': guard}, timezone.now()))
        self.assertFalse(push.still_valid({'valid_until': (timezone.now() - timedelta(minutes=1)).isoformat()}, timezone.now()))

    def test_many_due_reminders_are_sent_in_bounded_batches(self):
        for days in range(2, 5):
            for hour in (8, 9, 10):
                self.book(self.ana, at(days, hour))
        later = timezone.now() + timedelta(days=10)
        BookingReminder.objects.update(due_at=timezone.now() - timedelta(minutes=1))
        with mock.patch('notifications.push.notify'):
            self.assertTrue(services.send_due_reminders(limit=5))  # more left: continue
            while services.send_due_reminders(limit=5):
                pass
        self.assertFalse(BookingReminder.objects.filter(sent_at__isnull=True).exists())
        self.assertIsNone(services.next_reminder_due(now=later))


class ReminderRaceTests(APITransactionTestCase):
    """A cancellation and the due reminder at the same moment: never a reminder for a cancelled session."""

    def test_a_cancellation_in_progress_wins_over_the_reminder(self):
        coach = make_user('rr-coach@example.test', coach=True)
        ana = make_user('rr-ana@example.test')
        link = CoachConnection.objects.create(coach=coach, client=ana)
        pt = SessionType.objects.create(coach=coach, name='PT', duration_minutes=60)
        booking = Booking.objects.create(coach=coach, client=ana, connection=link, session_type=pt, type_name='PT', type_mode='in_person',
                                         starts_at=at(1, 9), ends_at=at(1, 10), status='confirmed', created_by='coach')
        BookingReminder.objects.create(booking=booking, hours_before=24, due_at=timezone.now() - timedelta(minutes=1), for_start=booking.starts_at)
        cancelling = threading.Event()
        real_notify = services.notify
        sent = []

        def slow_cancel_notify(*args, **kwargs):
            cancelling.set()
            clock.sleep(0.8)  # the cancellation holds the collaboration lock meanwhile
            return real_notify(*args, **kwargs)

        def cancel():
            try:
                with mock.patch('scheduling.services.notify', side_effect=slow_cancel_notify):
                    services.cancel(booking.pk, user=coach)
            finally:
                connections.close_all()

        def remind():
            try:
                cancelling.wait(10)
                with mock.patch('notifications.push.notify', side_effect=lambda *a, **k: sent.append(k)):
                    services.send_due_reminders()
            finally:
                connections.close_all()

        threads = [threading.Thread(target=cancel), threading.Thread(target=remind)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        self.assertEqual(Booking.objects.get(pk=booking.pk).status, 'cancelled')
        self.assertEqual(sent, [])
