import datetime
import uuid

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from nutrition.models import MealEntry, NutritionDay, NutritionTarget
from progress.models import Goal, Measurement
from training.models import WorkoutSession

TODAY = timezone.localdate


def local(day: datetime.date, hour: int = 18) -> datetime.datetime:
    return timezone.make_aware(datetime.datetime.combine(day, datetime.time(hour)))


class Base(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def weigh(self, value, day):
        Measurement.objects.create(user=self.user, kind='weight', value=value, measured_on=day)

    def workout(self, when):
        WorkoutSession.objects.create(owner=self.user, name='T', started_at=when, finished_at=when + datetime.timedelta(hours=1))


class GoalTests(Base):
    def post(self, **body):
        return self.client.post('/api/progress/goals/', body, format='json')

    def test_weight_goal_starts_from_latest_measurement_and_tracks_progress(self):
        self.weigh(84, TODAY() - datetime.timedelta(days=10))
        res = self.post(kind='weight', target_value='80', start_value='99')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['start_value'], '84.00')  # poslata vrednost se ignoriše kad merenje postoji
        self.weigh(82, TODAY())
        goal = self.client.get('/api/progress/goals/').data[0]
        self.assertEqual((goal['state']['current'], goal['state']['progress'], goal['state']['reached']), ('82.00', 0.5, False))
        self.weigh(79.5, TODAY())
        state = self.client.get('/api/progress/goals/').data[0]['state']
        self.assertEqual((state['progress'], state['reached']), (1.0, True))

    def test_gain_goal_and_first_measurement_from_start_value(self):
        res = self.post(kind='arm', target_value='40', start_value='36')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(Measurement.objects.filter(user=self.user, kind='arm', value=36).exists())
        self.assertEqual(res.data['state']['progress'], 0.0)

    def test_first_goal_rejects_out_of_bounds_initial_measurement(self):
        for kind, start, target in [
            ('weight', '785', '78'),
            ('weight', '24.99', '78'),
            ('arm', '251', '40'),
            ('arm', '9', '40'),
        ]:
            with self.subTest(kind=kind, start=start):
                response = self.post(kind=kind, target_value=target, start_value=start)
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn('start_value', response.data)
                self.assertFalse(Measurement.objects.filter(user=self.user, kind=kind).exists())
                self.assertFalse(Goal.objects.filter(user=self.user, kind=kind).exists())

    def test_first_goal_accepts_measurement_boundaries(self):
        for kind, start, target in [('weight', '350', '75'), ('arm', '10', '40')]:
            with self.subTest(kind=kind):
                response = self.post(kind=kind, start_value=start, target_value=target)
                self.assertEqual(response.status_code, 201, response.data)
                self.assertTrue(Measurement.objects.filter(user=self.user, kind=kind).exists())

    def test_workouts_goal_counts_this_week_and_recent_weeks(self):
        monday = TODAY() - datetime.timedelta(days=TODAY().weekday())
        self.workout(local(monday))
        self.workout(local(monday - datetime.timedelta(days=7)))
        self.workout(local(monday - datetime.timedelta(days=6)))
        self.workout(local(monday - datetime.timedelta(days=5)))
        state = self.post(kind='workouts_per_week', target_value='3').data['state']
        self.assertEqual(state['current'], 1)
        self.assertEqual([(w['count'], w['met']) for w in state['recent_weeks']], [(0, False), (0, False), (0, False), (3, True)])

    def test_validation_one_active_per_kind_and_close(self):
        self.assertEqual(self.post(kind='workouts_per_week', target_value='2.5').status_code, 400)
        self.assertEqual(self.post(kind='weight', target_value='80').status_code, 400)  # nema ni merenja ni polazne vrednosti
        self.assertEqual(self.post(kind='weight', target_value='900', start_value='80').status_code, 400)
        past = (TODAY() - datetime.timedelta(days=1)).isoformat()
        self.assertEqual(self.post(kind='weight', target_value='75', start_value='80', target_date=past).status_code, 400)

        gid = self.post(kind='workouts_per_week', target_value='3').data['id']
        self.assertEqual(self.post(kind='workouts_per_week', target_value='4').status_code, 400)
        res = self.client.post(f'/api/progress/goals/{gid}/close/', {'status': 'achieved'}, format='json')
        self.assertEqual((res.data['status'], res.data['closed_on']), ('achieved', TODAY().isoformat()))
        self.assertEqual(self.post(kind='workouts_per_week', target_value='4').status_code, 201)
        # Aktivni prvi
        self.assertEqual([g['status'] for g in self.client.get('/api/progress/goals/').data], ['active', 'achieved'])

    def test_repeat_goal_post_identical_is_success_changed_is_conflict(self):
        goal_id = str(uuid.uuid4())
        original = {'id': goal_id, 'kind': 'workouts_per_week', 'target_value': '3'}
        first = self.client.post('/api/progress/goals/', original, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        same = self.client.post('/api/progress/goals/', original, format='json')
        self.assertEqual(same.status_code, 200, same.data)
        equivalent = self.client.post('/api/progress/goals/', {**original, 'target_value': '3.00', 'target_date': None}, format='json')
        self.assertEqual(equivalent.status_code, 200, equivalent.data)
        retry = self.client.post('/api/progress/goals/', {**original, 'target_value': '4'}, format='json')
        self.assertEqual(retry.status_code, 409, retry.data)
        self.assertEqual(Goal.objects.get(pk=goal_id).target_value, 3)
        self.assertEqual(Goal.objects.count(), 1)

    def test_goal_replay_ignores_server_managed_start_fields_but_checks_target_date(self):
        self.weigh(84, TODAY() - datetime.timedelta(days=1))
        goal_id = str(uuid.uuid4())
        end = (TODAY() + datetime.timedelta(days=20)).isoformat()
        original = {'id': goal_id, 'kind': 'weight', 'target_value': '80', 'target_date': end, 'start_value': '99'}
        created = self.client.post('/api/progress/goals/', original, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['start_value'], '84.00')

        # A lost response should not require re-validating against the now-active goal.
        same = self.client.post('/api/progress/goals/', {**original, 'target_value': '80.00', 'start_value': None}, format='json')
        self.assertEqual(same.status_code, 200, same.data)
        self.assertEqual(same.data['start_value'], '84.00')

        changed_date = self.client.post(
            '/api/progress/goals/',
            {**original, 'target_date': (TODAY() + datetime.timedelta(days=21)).isoformat()},
            format='json',
        )
        self.assertEqual(changed_date.status_code, 409, changed_date.data)
        changed_kind = self.client.post('/api/progress/goals/', {**original, 'kind': 'waist'}, format='json')
        self.assertEqual(changed_kind.status_code, 409, changed_kind.data)
        self.assertEqual(Goal.objects.filter(pk=goal_id, target_date=end).count(), 1)
        self.assertEqual(Measurement.objects.filter(user=self.user, kind='weight').count(), 1)

    def test_goals_are_private(self):
        gid = self.post(kind='workouts_per_week', target_value='3', id=str(uuid.uuid4())).data['id']
        self.client.force_authenticate(User.objects.create_user('c@d.rs', 'jaka-lozinka-123'))
        self.assertEqual(self.client.get('/api/progress/goals/').data, [])
        self.assertEqual(self.client.post(f'/api/progress/goals/{gid}/close/', {'status': 'abandoned'}, format='json').status_code, 404)


class WeekTests(Base):
    MONDAY = datetime.date(2026, 9, 21)

    def entry(self, day, kcal, protein=None):
        MealEntry.objects.create(owner=self.user, date=day, meal='lunch', name='X', kcal=kcal, protein_g=protein)

    def test_averages_only_from_complete_days_with_coverage(self):
        d = lambda i: self.MONDAY + datetime.timedelta(days=i)  # noqa: E731
        self.entry(d(0), 2000, 150)
        self.entry(d(1), 1800, 120)
        self.entry(d(1), 300)  # nepoznati proteini
        self.entry(d(2), 500, 30)  # nepotpun dan (samo doručak) ne ulazi u prosek
        NutritionDay.objects.create(owner=self.user, date=d(0), status='complete')
        NutritionDay.objects.create(owner=self.user, date=d(1), status='complete')
        NutritionDay.objects.create(owner=self.user, date=d(2), status='incomplete')
        NutritionTarget.objects.create(owner=self.user, valid_from=d(0), mode='manual', kcal=2200)
        self.workout(local(d(0)))
        self.workout(local(d(6), 23))
        self.workout(local(d(7), 0))  # sledeći ponedeljak
        self.weigh(83, d(-3))
        self.weigh(82.4, d(4))

        w = self.client.get('/api/progress/week/', {'start': d(3).isoformat()}).data
        self.assertEqual((w['week_start'], w['week_end']), (d(0), d(6)))
        n = w['nutrition']
        self.assertEqual((n['complete_days'], n['avg_kcal'], n['avg_protein_g'], n['protein_g_unknown']), (2, '2050', '135.0', 1))
        self.assertEqual(n['avg_target_kcal'], '2200')
        self.assertEqual([x['status'] for x in n['days']][:4], ['complete', 'complete', 'incomplete', None])
        self.assertEqual(w['workouts']['count'], 2)
        self.assertEqual((w['weight']['latest'], w['weight']['change']), ('82.40', '-0.60'))

    def test_empty_week(self):
        w = self.client.get('/api/progress/week/', {'start': self.MONDAY.isoformat()}).data
        self.assertEqual((w['nutrition']['complete_days'], w['nutrition']['avg_kcal'], w['weight']), (0, None, None))
        self.assertEqual(self.client.get('/api/progress/week/', {'start': 'x'}).status_code, 400)
