"""Calendar and booking (T4a): free slots, booking rules, the database overlap guard, permissions."""

import threading
from datetime import datetime, time, timedelta
from unittest import mock
from uuid import uuid4

from django.db import IntegrityError, connections, transaction
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase, APITransactionTestCase

from accounts.models import User
from coaching.models import CoachConnection
from scheduling.availability import LOCAL
from scheduling.models import Booking, BookingSettings, ScheduleException, SessionType, WorkingHours


def make_user(email, *, coach=False):
    user = User.objects.create_user(email, 'a-strong-secret')
    user.profile.is_coach = coach
    user.profile.save()
    return user


def at(days, hour, minute=0):
    """A local time `days` from today."""
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
        CoachConnection.objects.create(coach=self.other_coach, client=self.stranger)
        self.pt = SessionType.objects.create(coach=self.coach, name='Personalni trening', duration_minutes=60)
        for weekday in range(7):
            WorkingHours.objects.create(coach=self.coach, weekday=weekday, start_time=time(8), end_time=time(12))

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def book(self, user, starts_at, **body):
        self.as_user(user)
        return self.client.post('/api/schedule/bookings/', {
            'session_type_id': str(self.pt.pk), 'starts_at': starts_at.isoformat(), **body,
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

    def test_notice_and_horizon(self):
        BookingSettings.objects.create(coach=self.coach, horizon_days=3, min_notice_hours=0)
        self.assertEqual(self.slots(days=5), [])
        self.assertTrue(self.slots(days=2))

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
        self.assertEqual(self.book(self.ana, at(2, 9), id=booking_id).status_code, 200)
        self.assertEqual(self.book(self.ana, at(2, 10), id=booking_id).status_code, 400)
        self.assertEqual(Booking.objects.count(), 1)

    def test_only_free_slots_for_clients(self):
        for starts_at in (at(2, 7), at(2, 11, 30), at(2, 8, 10), timezone.now() + timedelta(minutes=30), at(40, 9)):
            response = self.book(self.ana, starts_at)
            self.assertIn(response.status_code, (400, 409), starts_at)
        self.assertFalse(Booking.objects.exists())

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
        # Declined frees the time.
        self.assertEqual(self.book(self.ana, at(2, 11)).status_code, 201)
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
        # Cancelled frees the time.
        self.assertEqual(self.book(self.ben, at(2, 9)).status_code, 201)

    def test_the_coach_books_any_free_time_for_his_own_active_clients(self):
        response = self.book(self.coach, at(3, 18), connection_id=str(self.ana_link.pk))
        self.assertEqual((response.status_code, response.data['status'], response.data['created_by']), (201, 'confirmed', 'coach'))
        stranger_link = CoachConnection.objects.get(client=self.stranger)
        self.assertEqual(self.book(self.coach, at(3, 9), connection_id=str(stranger_link.pk)).status_code, 409)
        self.assertEqual(self.book(self.coach, at(3, 9)).status_code, 400)  # which client?
        CoachConnection.objects.filter(pk=self.ben_link.pk).update(ended_at=timezone.now())
        self.assertEqual(self.book(self.coach, at(3, 9), connection_id=str(self.ben_link.pk)).status_code, 409)

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

    def test_the_coach_sees_his_calendar_and_counts(self):
        BookingSettings.objects.create(coach=self.coach, auto_confirm=False)
        self.book(self.ana, at(2, 9))
        self.as_user(self.coach)
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        data = self.client.get(f'/api/schedule/calendar/?from={day}&to={day}').data
        self.assertEqual([(b['client']['name'], b['status']) for b in data['bookings']], [('cal-ana', 'requested')])
        self.assertEqual(data['requests'], 1)
        self.assertEqual(self.client.get('/api/coach/dashboard/').data['booking_requests'], 1)


class SetupTests(BookingTestCase):
    def test_settings_hours_types_and_exceptions_are_validated(self):
        self.as_user(self.coach)
        self.assertEqual(self.client.put('/api/schedule/settings/', {'auto_confirm': False, 'cancel_hours': 500, 'min_notice_hours': 2,
                                                                     'horizon_days': 28, 'slot_step_minutes': 30}, format='json').status_code, 400)
        overlapping = {'windows': [{'weekday': 0, 'start': '08:00', 'end': '12:00'}, {'weekday': 0, 'start': '11:00', 'end': '14:00'}]}
        self.assertEqual(self.client.put('/api/schedule/hours/', overlapping, format='json').status_code, 400)
        week = {'windows': [{'weekday': 0, 'start': '08:00', 'end': '12:00'}, {'weekday': 0, 'start': '16:00', 'end': '20:00'}]}
        self.assertEqual(len(self.client.put('/api/schedule/hours/', week, format='json').data['windows']), 2)
        self.assertEqual(self.client.post('/api/schedule/session-types/', {'name': 'X', 'duration_minutes': 5, 'mode': 'online'}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(f'/api/schedule/session-types/{self.pt.pk}/').status_code, 204)
        self.assertEqual(self.client.get('/api/schedule/session-types/').data, [])
        # A closed day shows what is already booked then (nothing is cancelled by itself).
        self.as_user(self.ana)
        self.pt.archived_at = None
        self.pt.save()
        WorkingHours.objects.create(coach=self.coach, weekday=at(2, 9).weekday(), start_time=time(8), end_time=time(12))
        self.book(self.ana, at(2, 9))
        self.as_user(self.coach)
        closed = self.client.post('/api/schedule/exceptions/', {'kind': 'closed', 'starts_at': at(2, 0).isoformat(),
                                                                'ends_at': at(3, 0).isoformat(), 'note': 'Praznik'}, format='json')
        self.assertEqual(len(closed.data['conflicts']), 1)
        self.as_user(self.ana)
        self.assertEqual(self.client.post('/api/schedule/exceptions/', {}, format='json').status_code, 403)


class DatabaseGuardTests(APITransactionTestCase):
    """The overlap rule holds in the database itself, also for requests at the same moment."""

    def setUp(self):
        self.coach = make_user('guard-coach@example.test', coach=True)
        self.clients = [make_user(f'guard-c{i}@example.test') for i in range(2)]
        self.links = [CoachConnection.objects.create(coach=self.coach, client=c) for c in self.clients]
        self.pt = SessionType.objects.create(coach=self.coach, name='PT', duration_minutes=60)
        for weekday in range(7):
            WorkingHours.objects.create(coach=self.coach, weekday=weekday, start_time=time(8), end_time=time(12))

    def test_the_database_refuses_an_overlap_even_without_the_application(self):
        Booking.objects.create(coach=self.coach, client=self.clients[0], connection=self.links[0], session_type=self.pt,
                               starts_at=at(2, 9), ends_at=at(2, 10), status='confirmed', created_by='client')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Booking.objects.create(coach=self.coach, client=self.clients[1], connection=self.links[1], session_type=self.pt,
                                   starts_at=at(2, 9, 30), ends_at=at(2, 10, 30), status='requested', created_by='client')
        # Back to back is fine; a cancelled booking holds nothing.
        Booking.objects.create(coach=self.coach, client=self.clients[1], connection=self.links[1], session_type=self.pt,
                               starts_at=at(2, 10), ends_at=at(2, 11), status='confirmed', created_by='client')

    def test_two_clients_at_the_same_moment_one_gets_it(self):
        results = []
        start = threading.Barrier(2, timeout=20)

        def book(user):
            try:
                client = APIClient()
                client.force_authenticate(user=user)
                start.wait()
                results.append(client.post('/api/schedule/bookings/', {
                    'session_type_id': str(self.pt.pk), 'starts_at': at(2, 9).isoformat()}, format='json').status_code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=book, args=(c,)) for c in self.clients]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(Booking.objects.count(), 1)
