import uuid
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.export import collect
from accounts.models import User
from training.models import Exercise, SessionExercise


class SupersetTests(APITestCase):
    """Exercises next to each other with the same `superset` number are done back to back."""

    def setUp(self):
        self.user = User.objects.create_user('ss@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.ids = [str(Exercise.objects.get(slug=slug).id) for slug in ('bench-press', 'barbell-row', 'back-squat', 'plank')]

    def routine(self, groups, **extra):
        return {
            'name': 'Supersets', 'notes': '',
            'exercises': [
                {'exercise_id': self.ids[i % 4], 'rest_seconds': 60, 'notes': '', 'superset': group,
                 'sets': [{'set_type': 'working', 'reps_min': 10, 'reps_max': 10}]}
                for i, group in enumerate(groups)
            ],
            **extra,
        }

    def create(self, body):
        return self.client.post('/api/training/routines/', body, format='json')

    def groups(self, response):
        return [e['superset'] for e in response.data['exercises']]

    def test_supersets_are_saved_and_numbered_in_order(self):
        response = self.create(self.routine([None, 7, 7, 3, 3, 3]))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.groups(response), [None, 1, 1, 2, 2, 2])
        detail = self.client.get(f"/api/training/routines/{response.data['id']}/")
        self.assertEqual(self.groups(detail), [None, 1, 1, 2, 2, 2])

    def test_a_number_on_one_exercise_alone_means_nothing(self):
        response = self.create(self.routine([5, None, 2, 2]))
        self.assertEqual(self.groups(response), [None, None, 1, 1])

    def test_older_apps_without_the_field_still_save(self):
        body = self.routine([None, None])
        for item in body['exercises']:
            del item['superset']
        response = self.create(body)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.groups(response), [None, None])

    def test_members_must_be_next_to_each_other(self):
        response = self.create(self.routine([1, None, 1]))
        self.assertEqual(response.status_code, 400)
        self.assertIn('exercises', response.data)

    def test_at_most_three_exercises(self):
        self.assertEqual(self.create(self.routine([1, 1, 1])).status_code, 201)
        response = self.create(self.routine([1, 1, 1, 1]))
        self.assertEqual(response.status_code, 400)

    def test_an_exact_retry_of_an_edit_is_not_a_conflict(self):
        created = self.create(self.routine([None, 1, 1]))
        routine_id = created.data['id']
        body = {**self.routine([1, 1, None]), 'revision': created.data['updated_at']}
        first = self.client.put(f'/api/training/routines/{routine_id}/', body, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(self.groups(first), [1, 1, None])
        retry = self.client.put(f'/api/training/routines/{routine_id}/', body, format='json')
        self.assertEqual(retry.status_code, 200, retry.data)

    def test_a_copy_keeps_the_supersets(self):
        created = self.create(self.routine([1, 1, None]))
        copy = self.client.post(f"/api/training/routines/{created.data['id']}/duplicate/")
        self.assertEqual(copy.status_code, 201, copy.data)
        self.assertEqual(self.groups(copy), [1, 1, None])

    def session(self, groups, empty=()):
        start = timezone.now() - timedelta(hours=1)
        done = [{'set_type': 'working', 'weight_kg': '20', 'reps': 10, 'completed_at': start.isoformat()}]
        return {
            'id': str(uuid.uuid4()), 'routine_id': None, 'name': 'Supersets',
            'started_at': start.isoformat(), 'finished_at': (start + timedelta(minutes=40)).isoformat(),
            'plan_snapshot': None, 'feeling': None, 'notes': '',
            'exercises': [
                {'exercise_id': self.ids[i % 4], 'notes': '', 'superset': group, 'sets': [] if i in empty else done}
                for i, group in enumerate(groups)
            ],
        }

    def test_a_finished_workout_keeps_its_supersets(self):
        response = self.client.post('/api/training/sessions/', self.session([1, 1, None]), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.groups(response), [1, 1, None])

    def test_a_superset_partner_with_no_sets_leaves_a_single_exercise(self):
        # The second superset lost one exercise (nothing confirmed), the first is renumbered.
        body = self.session([1, 1, None, 2, 2, 3, 3], empty={1})
        response = self.client.post('/api/training/sessions/', body, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        stored = SessionExercise.objects.filter(session_id=body['id']).order_by('position')
        self.assertEqual([e.superset for e in stored], [None, None, 1, 1, 2, 2])

    def test_a_workout_with_split_superset_is_refused(self):
        response = self.client.post('/api/training/sessions/', self.session([1, None, 1]), format='json')
        self.assertEqual(response.status_code, 400)

    def test_export_includes_supersets(self):
        self.create(self.routine([1, 1]))
        self.client.post('/api/training/sessions/', self.session([1, 1]), format='json')
        data = collect(self.user)
        self.assertEqual([e['superset'] for e in data['routines'][0]['exercises']], [1, 1])
        self.assertEqual([e['superset'] for e in data['workouts'][0]['exercises']], [1, 1])
