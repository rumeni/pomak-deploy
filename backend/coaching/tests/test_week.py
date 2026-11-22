"""The week in review ("Nedelja", T2c): facts, the athlete's check-in, the coach's view and comments."""

import datetime
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import ClientPlan, ClientPlanDay, ClientPlanVersion, CoachConnection, CoachMessage, CoachTask
from progress.models import Measurement, WeeklyCheckIn
from training.models import Routine, WorkoutSession


class WeekTestCase(APITestCase):
    def setUp(self):
        self.coach = self.user('week-coach@example.test', coach=True)
        self.other_coach = self.user('week-other@example.test', coach=True)
        self.ana = self.user('week-ana@example.test')
        self.solo = self.user('week-solo@example.test')
        self.today = timezone.localdate()
        self.monday = self.today - timedelta(days=self.today.weekday())
        now = timezone.now()
        # Never before local midnight: in the first 30 minutes of a Monday, "30 minutes ago" is last week.
        midnight = timezone.make_aware(datetime.datetime.combine(self.today, datetime.time.min))
        started = max(now - timedelta(minutes=30), midnight)
        WorkoutSession.objects.create(owner=self.ana, name='Upper A', started_at=started, finished_at=now, sleep_hours=8, motivation=5)
        Measurement.objects.create(user=self.ana, kind=Measurement.Kind.WEIGHT, value='80.0', measured_on=self.today)

    def user(self, email, *, coach=False):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.save()
        return user

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def own(self, day=None):
        return f'/api/progress/weeks/{(day or self.today).isoformat()}/review/'

    def checkin(self, user, day=None, share=True, **body):
        """Saved as the form does: shared with the coach it shows (if any, and `share`), else private."""
        self.as_user(user)
        coach = CoachConnection.objects.filter(client=user, ended_at__isnull=True).first()
        share_with = str(coach.pk) if coach and share else None
        return self.client.put(self.own(day), {'energy': 4, 'hardest': 'Malo sna', 'share_with': share_with, **body}, format='json')


class OwnWeekTests(WeekTestCase):
    def test_a_user_without_a_coach_reviews_and_checks_in(self):
        self.as_user(self.ana)
        review = self.client.get(self.own()).data
        self.assertEqual(review['week_start'], self.monday)
        self.assertEqual(review['training']['sessions'], 1)
        self.assertEqual(review['weight']['latest'], '80.00')
        self.assertEqual(review['readiness']['checkins'], 1)
        self.assertIsNone(review['plan'])
        self.assertIsNone(review['check_in'])
        first = self.checkin(self.ana)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data['check_in']['energy'], 4)
        self.checkin(self.ana, energy=5)  # again: the same check-in, updated
        self.assertEqual(WeeklyCheckIn.objects.get(user=self.ana).energy, 5)
        self.assertFalse(CoachTask.objects.exists())  # no coach, nobody to tell

    def test_only_this_week_or_the_last_eight(self):
        self.assertEqual(self.checkin(self.ana, day=self.monday + timedelta(days=7)).status_code, 400)
        self.assertEqual(self.checkin(self.ana, day=self.monday - timedelta(weeks=9)).status_code, 400)
        self.assertEqual(self.checkin(self.ana, day=self.monday - timedelta(weeks=8)).status_code, 200)
        self.assertEqual(self.checkin(self.ana, energy=7).status_code, 400)
        self.as_user(self.ana)
        self.assertEqual(self.client.get('/api/progress/weeks/nope/review/').status_code, 400)


class CoachWeekTests(WeekTestCase):
    def setUp(self):
        super().setUp()
        self.connection = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.url = f'/api/coach/clients/{self.ana.pk}/weeks/{self.today.isoformat()}/'

    def test_the_check_in_raises_one_task_and_the_coach_sees_only_what_is_shared(self):
        self.checkin(self.ana)
        self.checkin(self.ana, energy=3)
        tasks = CoachTask.objects.filter(kind='weekly_checkin')
        self.assertEqual([t.key for t in tasks], [self.monday.isoformat()])
        self.as_user(self.coach)
        review = self.client.get(self.url).data
        self.assertEqual(review['check_in']['energy'], 3)
        self.assertEqual(review['training']['sessions'], 1)
        self.assertEqual((review['weight'], review['nutrition'], review['readiness']), (None, None, None))
        CoachConnection.objects.filter(pk=self.connection.pk).update(share_measurements=True, share_nutrition=True, share_readiness=True)
        review = self.client.get(self.url).data
        self.assertEqual(review['weight']['latest'], '80.00')
        self.assertIsNotNone(review['nutrition'])
        self.assertEqual(review['readiness']['checkins'], 1)
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_the_week_shows_how_many_workouts_the_plan_had(self):
        routine = Routine.objects.create(owner=self.ana, name='Plan A')
        # Connected since Monday: the whole week counts (days before connecting would not).
        CoachConnection.objects.filter(pk=self.connection.pk).update(
            created_at=timezone.make_aware(datetime.datetime.combine(self.monday, datetime.time(0, 1))))
        plan = ClientPlan.objects.create(connection=CoachConnection.objects.get(pk=self.connection.pk))
        version = ClientPlanVersion.objects.create(plan=plan, valid_from=self.monday, name='Plan')
        ClientPlanDay.objects.bulk_create([ClientPlanDay(version=version, weekday=w, routine=routine, prescription={'name': 'Plan A'}) for w in (0, 3)])
        self.as_user(self.ana)
        self.assertEqual(self.client.get(self.own()).data['plan'], {'planned': 2})

    def test_a_comment_on_the_week_is_a_message_about_that_week(self):
        self.as_user(self.coach)
        sent = self.client.post('/api/coach/messages/', {
            'text': 'Dobra nedelja!', 'client_id': str(self.ana.pk), 'week': self.today.isoformat(),
        }, format='json')
        self.assertEqual(sent.status_code, 201, sent.data)
        self.assertEqual(sent.data['week_start'], self.monday)
        self.client.post('/api/coach/messages/', {'text': 'Other', 'client_id': str(self.ana.pk)}, format='json')
        self.as_user(self.ana)
        on_week = self.client.get('/api/coach/messages/', {'week': (self.monday + timedelta(days=2)).isoformat()}).data
        self.assertEqual([m['text'] for m in on_week], ['Dobra nedelja!'])
        self.assertEqual(self.client.post('/api/coach/messages/', {
            'text': 'x', 'week': (self.monday + timedelta(days=7)).isoformat(),
        }, format='json').status_code, 400)
        self.assertEqual(CoachMessage.objects.count(), 2)
        self.assertIsInstance(on_week[0]['week_start'], (str, datetime.date))

    def test_planned_workouts_of_past_weeks_survive_a_disconnect_and_a_new_coach(self):
        routine = Routine.objects.create(owner=self.ana, name='Plan A')
        start = self.monday - timedelta(weeks=2)
        CoachConnection.objects.filter(pk=self.connection.pk).update(created_at=timezone.make_aware(datetime.datetime.combine(start, datetime.time(8))))
        plan = ClientPlan.objects.create(connection=self.connection)
        version = ClientPlanVersion.objects.create(plan=plan, valid_from=start, name='Plan')
        ClientPlanDay.objects.bulk_create([ClientPlanDay(version=version, weekday=w, routine=routine, prescription={'name': 'Plan A'}) for w in (0, 2, 4)])
        past = (self.monday - timedelta(weeks=1)).isoformat()
        self.as_user(self.ana)
        self.assertEqual(self.client.get(f'/api/progress/weeks/{past}/review/').data['plan'], {'planned': 3})
        # The client ends it, then connects to another coach with another plan.
        self.client.delete('/api/coach/connection/')
        self.assertEqual(self.client.get(f'/api/progress/weeks/{past}/review/').data['plan'], {'planned': 3})
        other = CoachConnection.objects.create(coach=self.other_coach, client=self.ana)
        other_plan = ClientPlan.objects.create(connection=other)
        other_version = ClientPlanVersion.objects.create(plan=other_plan, valid_from=start, name='Other')
        ClientPlanDay.objects.create(version=other_version, weekday=1, routine=routine, prescription={'name': 'X'})
        self.assertEqual(self.client.get(f'/api/progress/weeks/{past}/review/').data['plan'], {'planned': 3})


class CheckInSharingTests(WeekTestCase):
    def test_a_private_check_in_stays_private_and_a_new_coach_gets_none_of_the_old_ones(self):
        self.checkin(self.ana, hardest='Privatno')  # no coach yet: a note to self
        connection = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        url = f'/api/coach/clients/{self.ana.pk}/weeks/{self.today.isoformat()}/'
        self.as_user(self.coach)
        self.assertIsNone(self.client.get(url).data['check_in'])
        self.assertFalse(CoachTask.objects.exists())
        self.as_user(self.ana)
        self.assertFalse(self.client.get(self.own()).data['check_in']['shared_with_coach'])
        # Saved again with a coach (the form says the coach sees it): now his.
        self.checkin(self.ana, hardest='Za trenera')
        self.as_user(self.coach)
        self.assertEqual(self.client.get(url).data['check_in']['hardest'], 'Za trenera')
        self.assertEqual(CoachTask.objects.filter(kind='weekly_checkin').count(), 1)
        # Ended, then a new coach: he does not inherit it.
        CoachConnection.objects.filter(pk=connection.pk).update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.other_coach, client=self.ana)
        self.as_user(self.other_coach)
        self.assertIsNone(self.client.get(f'/api/coach/clients/{self.ana.pk}/weeks/{self.today.isoformat()}/').data['check_in'])


class CheckInRecipientTests(WeekTestCase):
    def test_a_private_note_stays_private_even_with_a_coach(self):
        CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.checkin(self.ana, share=False)
        self.assertIsNone(WeeklyCheckIn.objects.get(user=self.ana).shared_with)
        self.assertFalse(CoachTask.objects.exists())

    def test_a_coach_change_between_loading_and_saving_shares_with_nobody(self):
        a = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        # The form showed coach A; meanwhile A ended and B connected (another tab or device).
        CoachConnection.objects.filter(pk=a.pk).update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.other_coach, client=self.ana)
        self.as_user(self.ana)
        response = self.client.put(self.own(), {'energy': 3, 'share_with': str(a.pk)}, format='json')
        self.assertEqual((response.status_code, response.data['code']), (409, 'collaboration_changed'))
        self.assertFalse(WeeklyCheckIn.objects.exists())
        self.assertFalse(CoachTask.objects.exists())
        # Someone else's collaboration is refused the same way.
        other = CoachConnection.objects.create(coach=self.coach, client=self.solo)
        self.assertEqual(self.client.put(self.own(), {'share_with': str(other.pk)}, format='json').status_code, 409)
        # Without saying who it is for, nothing is saved.
        self.assertEqual(self.client.put(self.own(), {'energy': 3}, format='json').status_code, 400)


class CheckInWithdrawalTests(WeekTestCase):
    def test_withdrawal_removes_task_and_versions_access(self):
        from coaching.tasks import weekly_checkin_task

        connection = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        url = f'/api/coach/clients/{self.ana.pk}/weeks/{self.today.isoformat()}/'
        self.assertEqual(self.checkin(self.ana, notes='Shared note').status_code, 200)
        task = CoachTask.objects.get(kind='weekly_checkin', connection=connection)
        self.as_user(self.coach)
        before = self.client.get(url).data
        self.assertEqual(before['check_in']['notes'], 'Shared note')

        self.assertEqual(self.checkin(self.ana, share=False, notes='Private note').status_code, 200)
        # A delayed task writer must not resurrect the withdrawn check-in.
        weekly_checkin_task(connection.pk, self.monday)
        self.assertFalse(CoachTask.objects.filter(kind='weekly_checkin', connection=connection).exists())
        self.as_user(self.coach)
        after = self.client.get(url).data
        self.assertIsNone(after['check_in'])
        self.assertEqual(after['access']['access_version'], before['access']['access_version'] + 1)
        self.assertEqual(self.client.patch(f'/api/coach/tasks/{task.pk}/', {'action': 'done'}, format='json').status_code, 404)

        self.assertEqual(self.checkin(self.ana, share=False, notes='Still private').status_code, 200)
        connection.refresh_from_db()
        self.assertEqual(connection.access_version, after['access']['access_version'])
        self.assertEqual(self.checkin(self.ana, notes='Shared again').status_code, 200)
        self.assertEqual(CoachTask.objects.filter(kind='weekly_checkin', connection=connection).count(), 1)
        self.as_user(self.coach)
        fresh = self.client.get(url).data
        self.assertEqual(fresh['check_in']['notes'], 'Shared again')
        self.assertEqual(fresh['access']['access_version'], after['access']['access_version'] + 1)
