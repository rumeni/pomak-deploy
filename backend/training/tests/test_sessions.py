import uuid
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from training.models import Exercise, Routine, SetLog, WorkoutSession


class WorkoutSessionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.bench = Exercise.objects.get(slug='bench-press')
        self.squat = Exercise.objects.get(slug='back-squat')

    def payload(self, **extra):
        start = timezone.now() - timedelta(hours=1)
        return {
            'id': str(uuid.uuid4()),
            'routine_id': None,
            'name': 'Trening A',
            'started_at': start.isoformat(),
            'finished_at': (start + timedelta(minutes=55)).isoformat(),
            'plan_snapshot': {'name': 'Trening A', 'exercises': []},
            'feeling': 4,
            'notes': 'Dobar dan',
            'exercises': [
                {'exercise_id': str(self.bench.id), 'notes': '', 'sets': [
                    {'set_type': 'warmup', 'weight_kg': '40', 'reps': 10, 'completed_at': start.isoformat()},
                    {'set_type': 'working', 'weight_kg': '62.5', 'reps': 8, 'completed_at': start.isoformat()},
                ]},
                # Vežba bez potvrđenih serija ne ulazi u odrađeni trening.
                {'exercise_id': str(self.squat.id), 'notes': '', 'sets': []},
            ],
            **extra,
        }

    def post(self, body):
        return self.client.post('/api/training/sessions/', body, format='json')

    def test_create_stores_only_exercises_with_confirmed_sets(self):
        res = self.post(self.payload())
        self.assertEqual(res.status_code, 201, res.data)
        session = WorkoutSession.objects.get()
        self.assertEqual([e.exercise_id for e in session.exercises.all()], [self.bench.id])
        self.assertEqual(SetLog.objects.count(), 2)
        self.assertTrue(all(s.logged_by_id == self.user.pk for s in SetLog.objects.all()))

    def test_resending_same_workout_does_not_duplicate(self):
        """AC-02: ponovljeno slanje posle prekida veze ne duplira trening ni serije."""
        body = self.payload()
        self.assertEqual(self.post(body).status_code, 201)
        self.assertEqual(self.post(body).status_code, 200)
        self.assertEqual(WorkoutSession.objects.count(), 1)
        self.assertEqual(SetLog.objects.count(), 2)

    def test_changing_routine_does_not_change_finished_workout(self):
        """AC-03: izmena rutine ne menja završeni trening."""
        routine = Routine.objects.create(owner=self.user, name='Trening A')
        snapshot = {'name': 'Trening A', 'exercises': [{'exercise_id': str(self.bench.id), 'sets': 3}]}
        res = self.post(self.payload(routine_id=str(routine.id), plan_snapshot=snapshot))
        self.assertEqual(res.status_code, 201, res.data)

        routine.name = 'Promenjena rutina'
        routine.save()
        routine.delete()

        session = WorkoutSession.objects.get()
        self.assertEqual(session.plan_snapshot, snapshot)
        self.assertEqual(session.name, 'Trening A')
        self.assertIsNone(session.routine)
        self.assertEqual(session.exercises.first().sets.count(), 2)

    def test_validation(self):
        self.assertEqual(self.post(self.payload(exercises=[
            {'exercise_id': str(self.bench.id), 'notes': '', 'sets': []},
        ])).status_code, 400)

        start = timezone.now()
        self.assertEqual(self.post(self.payload(
            started_at=start.isoformat(), finished_at=(start - timedelta(minutes=1)).isoformat(),
        )).status_code, 400)

        body = self.payload()
        body['exercises'][0]['sets'][0] = {'set_type': 'working', 'weight_kg': None, 'reps': None}
        self.assertEqual(self.post(body).status_code, 400)

    def test_cannot_attach_other_users_routine(self):
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        routine = Routine.objects.create(owner=other, name='Tuđa')
        self.assertEqual(self.post(self.payload(routine_id=str(routine.id))).status_code, 400)

    def test_history_is_private_and_newest_first(self):
        older = self.payload()
        older['started_at'] = (timezone.now() - timedelta(days=2)).isoformat()
        older['finished_at'] = (timezone.now() - timedelta(days=2) + timedelta(hours=1)).isoformat()
        older['name'] = 'Stariji'
        self.post(older)
        self.post(self.payload(name='Noviji'))
        self.assertEqual([s['name'] for s in self.client.get('/api/training/sessions/').data], ['Noviji', 'Stariji'])

        self.client.force_authenticate(User.objects.create_user('c@d.rs', 'jaka-lozinka-123'))
        self.assertEqual(self.client.get('/api/training/sessions/').data, [])

    def test_previous_returns_last_result_per_exercise(self):
        older = self.payload()
        older['started_at'] = (timezone.now() - timedelta(days=3)).isoformat()
        older['finished_at'] = (timezone.now() - timedelta(days=3) + timedelta(hours=1)).isoformat()
        older['exercises'][0]['sets'] = [{'set_type': 'working', 'weight_kg': '50', 'reps': 10}]
        self.post(older)
        self.post(self.payload())

        res = self.client.get('/api/training/sessions/previous/', {'exercise_ids': f'{self.bench.id},{self.squat.id},x'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(list(res.data), [str(self.bench.id)])
        self.assertEqual([s['weight_kg'] for s in res.data[str(self.bench.id)]['sets']], ['40.00', '62.50'])

    def test_previous_ignores_other_users(self):
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        self.post(self.payload())
        self.client.force_authenticate(self.user)
        res = self.client.get('/api/training/sessions/previous/', {'exercise_ids': str(self.bench.id)})
        self.assertEqual(res.data, {})
