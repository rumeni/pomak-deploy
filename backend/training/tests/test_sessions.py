import json
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

    def test_session_accepts_same_boundaries_as_a_routine(self):
        exercise = {'exercise_id': str(self.bench.id), 'notes': '',
                    'sets': [{'set_type': 'working', 'weight_kg': '20', 'reps': 8}]}
        forty = self.post(self.payload(exercises=[exercise for _ in range(40)]))
        self.assertEqual(forty.status_code, 201, forty.data)
        twenty = self.post(self.payload(exercises=[
            {**exercise, 'sets': [exercise['sets'][0] for _ in range(20)]},
        ]))
        self.assertEqual(twenty.status_code, 201, twenty.data)

    def test_session_rejects_oversized_arrays_without_writing_records(self):
        exercise = {'exercise_id': str(self.bench.id), 'notes': '',
                    'sets': [{'set_type': 'working', 'weight_kg': '20', 'reps': 8}]}
        too_many_exercises = self.post(self.payload(exercises=[exercise for _ in range(41)]))
        self.assertEqual(too_many_exercises.status_code, 400)
        self.assertIn('exercises', too_many_exercises.data)

        too_many_sets = self.post(self.payload(exercises=[
            {**exercise, 'sets': [exercise['sets'][0] for _ in range(21)]},
        ]))
        self.assertEqual(too_many_sets.status_code, 400)
        self.assertIn('sets', str(too_many_sets.data))
        self.assertEqual(WorkoutSession.objects.count(), 0)
        self.assertEqual(SetLog.objects.count(), 0)

    def test_session_rejects_unpaired_unicode_surrogate_as_400(self):
        # Escaped lone UTF-16 surrogates are valid JSON syntax, but cannot be
        # encoded as UTF-8 when snapshot size is validated.
        body = self.payload(plan_snapshot={'note': chr(0xD800)})
        response = self.client.post(
            '/api/training/sessions/', data=json.dumps(body), content_type='application/json',
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('plan_snapshot', response.data)
        self.assertEqual(WorkoutSession.objects.count(), 0)

    def test_session_rejects_oversized_plan_snapshot_without_writing(self):
        response = self.post(self.payload(plan_snapshot={'notes': 'x' * (256 * 1024)}))
        self.assertEqual(response.status_code, 400)
        self.assertIn('plan_snapshot', response.data)
        self.assertEqual(WorkoutSession.objects.count(), 0)

    def test_cannot_attach_other_users_routine(self):
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        routine = Routine.objects.create(owner=other, name='Tuđa')
        self.assertEqual(self.post(self.payload(routine_id=str(routine.id))).status_code, 400)

    def test_cursor_history_loads_more_than_fifty_without_shifting_or_leaking(self):
        start = timezone.now() - timedelta(days=10)
        for i in range(56):
            t = start + timedelta(minutes=i)
            WorkoutSession.objects.create(
                owner=self.user, name=f'Workout {i}', started_at=t,
                finished_at=t + timedelta(minutes=10),
            )

        first = self.client.get('/api/training/sessions/')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.data), 50)
        self.assertEqual(first.data[0]['name'], 'Workout 55')
        cursor = {'before': first.data[-1]['started_at'], 'before_id': first.data[-1]['id']}

        # A newly logged workout should NOT move the page boundary.
        WorkoutSession.objects.create(
            owner=self.user, name='Newly arrived', started_at=timezone.now(),
            finished_at=timezone.now() + timedelta(minutes=1),
        )
        second = self.client.get('/api/training/sessions/', cursor)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(second.data), 6)
        self.assertEqual(second.data[0]['name'], 'Workout 5')
        self.assertEqual(second.data[-1]['name'], 'Workout 0')
        self.assertFalse({s['id'] for s in first.data} & {s['id'] for s in second.data})

        self.client.force_authenticate(User.objects.create_user('stranger@example.com', 'strong-pass-123'))
        self.assertEqual(self.client.get('/api/training/sessions/', cursor).data, [])

    def test_invalid_history_cursor_returns_400(self):
        path = '/api/training/sessions/'
        bad_cursors = (
            {'before': '2026-09-30T10:00:00Z'},
            {'before_id': str(uuid.uuid4())},
            {'before': 'yesterday', 'before_id': str(uuid.uuid4())},
            {'before': '2026-09-30T10:00:00', 'before_id': str(uuid.uuid4())},
            {'before': '2026-09-30T10:00:00Z', 'before_id': 'not-a-uuid'},
        )
        for params in bad_cursors:
            with self.subTest(params=params):
                self.assertEqual(self.client.get(path, params).status_code, 400)

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


class ReadinessAndRpeTests(APITestCase):
    """Pre-workout check-in and per-set RPE are optional extras on a finished workout."""

    def setUp(self):
        self.user = User.objects.create_user('rpe@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.bench = Exercise.objects.get(slug='bench-press')

    def payload(self, sets, **extra):
        start = timezone.now() - timedelta(hours=1)
        return {
            'id': str(uuid.uuid4()), 'name': 'Trening', 'started_at': start.isoformat(),
            'finished_at': (start + timedelta(minutes=50)).isoformat(),
            'exercises': [{'exercise_id': str(self.bench.id), 'notes': '', 'sets': [
                {'set_type': 'working', 'completed_at': start.isoformat(), **s} for s in sets
            ]}],
            **extra,
        }

    def post(self, body):
        return self.client.post('/api/training/sessions/', body, format='json')

    def test_readiness_and_rpe_round_trip(self):
        readiness = {'sleep_hours': 7, 'hydration': 3, 'stress': 4, 'motivation': 5, 'soreness_upper': 1, 'soreness_lower': 2}
        res = self.post(self.payload([{'weight_kg': '100', 'reps': 3, 'rpe': 8.5}, {'weight_kg': '100', 'reps': 3}], readiness=readiness))
        self.assertEqual(res.status_code, 201, res.data)
        session = WorkoutSession.objects.get()
        self.assertEqual((session.sleep_hours, session.stress, session.soreness_lower), (7, 4, 2))
        data = self.client.get(f'/api/training/sessions/{session.id}/').json()
        self.assertEqual(data['readiness'], readiness)
        self.assertEqual([s['rpe'] for s in data['exercises'][0]['sets']], ['8.5', None])

    def test_both_are_optional(self):
        res = self.post(self.payload([{'weight_kg': '100', 'reps': 3}]))
        self.assertEqual(res.status_code, 201, res.data)
        data = self.client.get(f"/api/training/sessions/{res.data['id']}/").json()
        self.assertEqual(set(data['readiness'].values()), {None})
        # A partial check-in is fine as well.
        res = self.post(self.payload([{'weight_kg': '100', 'reps': 3}], readiness={'motivation': 2}))
        self.assertEqual(res.status_code, 201, res.data)

    def test_invalid_values_are_rejected_without_writing(self):
        for sets, readiness in (
            ([{'weight_kg': '100', 'reps': 3, 'rpe': 8.3}], {}),
            ([{'weight_kg': '100', 'reps': 3, 'rpe': 10.5}], {}),
            ([{'weight_kg': '100', 'reps': 3, 'rpe': 0.5}], {}),
            ([{'weight_kg': '100', 'reps': 3}], {'stress': 6}),
            ([{'weight_kg': '100', 'reps': 3}], {'motivation': 0}),
            ([{'weight_kg': '100', 'reps': 3}], {'sleep_hours': 15}),
        ):
            res = self.post(self.payload(sets, readiness=readiness))
            self.assertEqual(res.status_code, 400, (sets, readiness))
        self.assertEqual(WorkoutSession.objects.count(), 0)

    def test_routine_set_keeps_target_rpe(self):
        body = {'name': 'Snaga', 'notes': '', 'exercises': [{
            'exercise_id': str(self.bench.id), 'rest_seconds': 180, 'notes': '',
            'sets': [{'set_type': 'working', 'reps_min': 5, 'reps_max': 5, 'weight_kg': None,
                      'duration_seconds': None, 'distance_m': None, 'rpe': 8}],
        }]}
        res = self.client.post('/api/training/routines/', body, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.json()['exercises'][0]['sets'][0]['rpe'], '8.0')
        body['exercises'][0]['sets'][0]['rpe'] = 7.25
        self.assertEqual(self.client.post('/api/training/routines/', body, format='json').status_code, 400)
