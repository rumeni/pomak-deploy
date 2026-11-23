import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from training.exercise_library import UNILATERAL
from training.models import Exercise


class UnilateralTests(APITestCase):
    """Exercises done one side at a time: reps per side ("10 + 10"), volume counts both sides."""

    def setUp(self):
        self.user = User.objects.create_user('uni@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.cable_row = Exercise.objects.get(slug='single-arm-cable-row')  # total load, reps per arm
        self.dumbbell_row = Exercise.objects.get(slug='dumbbell-row')  # per dumbbell AND per arm

    def workout(self, exercise, sets, start=None):
        start = start or timezone.now() - timedelta(hours=2)
        body = {
            'id': str(uuid.uuid4()), 'name': 'T', 'started_at': start.isoformat(),
            'finished_at': (start + timedelta(hours=1)).isoformat(),
            'exercises': [{'exercise_id': str(exercise.id), 'notes': '', 'sets': [
                {'set_type': 'working', 'completed_at': start.isoformat(), **s} for s in sets
            ]}],
        }
        self.assertEqual(self.client.post('/api/training/sessions/', body, format='json').status_code, 201)

    def test_the_library_marks_one_side_exercises(self):
        marked = set(Exercise.objects.filter(owner__isnull=True, unilateral=True).values_list('slug', flat=True))
        self.assertEqual(marked, UNILATERAL)
        listed = self.client.get('/api/training/exercises/', {'q': 'bugarski'}).data
        self.assertTrue(listed and listed[0]['unilateral'])
        self.assertFalse(self.client.get('/api/training/exercises/', {'q': 'bench'}).data[0]['unilateral'])

    def test_own_exercise_can_be_one_side(self):
        response = self.client.post('/api/training/exercises/', {
            'name': 'Iskorak jednom nogom', 'equipment': 'bodyweight', 'measurement': 'bodyweight_reps',
            'muscle': 'legs', 'unilateral': True,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(Exercise.objects.get(pk=response.data['id']).unilateral)

    def test_volume_counts_both_sides_once(self):
        # 30 kg x 10 per arm = 600; a one-arm dumbbell row is one dumbbell, so also 2x (not 4x).
        self.workout(self.cable_row, [{'weight_kg': '30', 'reps': 10}])
        self.workout(self.dumbbell_row, [{'weight_kg': '20', 'reps': 10}])
        cable = self.client.get(f'/api/training/progress/exercises/{self.cable_row.id}/').json()['records']
        self.assertEqual(cable['session_volume']['value'], '600.00')
        dumbbell = self.client.get(f'/api/training/progress/exercises/{self.dumbbell_row.id}/').json()['records']
        self.assertEqual(dumbbell['session_volume']['value'], '400.00')
        # Strength records stay per side.
        self.assertEqual(cable['heaviest']['value'], '30.00')
        totals = self.client.get('/api/training/stats/', {'period': '30'}).json()['totals']
        self.assertEqual(totals['volume_kg'], '1000')
