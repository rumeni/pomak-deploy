import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from rest_framework.test import APITestCase

from accounts.models import User
from training.models import Exercise


def at(day: int) -> datetime:
    return datetime(2026, 9, day, 16, 0, tzinfo=dt_timezone.utc)


class ExerciseProgressTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.bench = Exercise.objects.get(slug='bench-press')
        self.dips = Exercise.objects.get(slug='dips')
        self.plank = Exercise.objects.get(slug='plank')

    def workout(self, day, exercise, sets):
        start = at(day)
        body = {
            'id': str(uuid.uuid4()), 'name': f'Trening {day}', 'started_at': start.isoformat(),
            'finished_at': (start + timedelta(hours=1)).isoformat(),
            'exercises': [{'exercise_id': str(exercise.id), 'notes': '', 'sets': [
                {'set_type': 'working', 'completed_at': start.isoformat(), **s} for s in sets
            ]}],
        }
        res = self.client.post('/api/training/sessions/', body, format='json')
        self.assertEqual(res.status_code, 201, res.data)

    def progress(self, exercise):
        return self.client.get(f'/api/training/progress/exercises/{exercise.id}/').json()

    def test_weight_records_chart_and_history(self):
        self.workout(1, self.bench, [{'weight_kg': '60', 'reps': 10}, {'weight_kg': '70', 'reps': 5}])
        self.workout(8, self.bench, [{'weight_kg': '80', 'reps': 1}, {'weight_kg': '50', 'reps': 20}])
        # Zagrevanje se ne računa u rekorde
        self.workout(15, self.bench, [{'weight_kg': '100', 'reps': 1, 'set_type': 'warmup'}, {'weight_kg': '70', 'reps': 5}])
        data = self.progress(self.bench)
        r = data['records']
        self.assertEqual((r['heaviest']['value'], r['heaviest']['date']), ('80.00', '2026-09-08'))
        # 60 × (1 + 10/30) = 80,0; 70 × (1 + 5/30) = 81,7 (prvi put 1. 9.); 20 ponavljanja se ne procenjuje
        self.assertEqual((r['e1rm']['value'], r['e1rm']['date'], r['e1rm']['reps']), ('81.7', '2026-09-01', 5))
        self.assertEqual(r['best_set_volume']['value'], '1000.00')  # 50 × 20
        self.assertEqual((r['session_volume']['value'], r['session_volume']['date']), ('1080.00', '2026-09-08'))
        self.assertEqual(data['chart']['metric'], 'heaviest')
        self.assertEqual([p['value'] for p in data['chart']['points']], ['70.00', '80.00', '70.00'])
        self.assertEqual([h['name'] for h in data['history']], ['Trening 15', 'Trening 8', 'Trening 1'])

    def test_bodyweight_and_duration_records(self):
        self.workout(1, self.dips, [{'reps': 8}, {'reps': 10}])
        self.workout(2, self.dips, [{'reps': 9}, {'reps': 9}, {'reps': 9}])
        r = self.progress(self.dips)['records']
        self.assertEqual((r['most_reps']['value'], r['session_reps']['value']), (10, 27))
        self.workout(3, self.plank, [{'duration_seconds': 60}, {'duration_seconds': 90}])
        data = self.progress(self.plank)
        self.assertEqual((data['records']['longest_duration']['value'], data['chart']['metric']), (90, 'longest_duration'))

    def test_performed_list_is_private_and_recent_first(self):
        self.workout(1, self.bench, [{'weight_kg': '60', 'reps': 10}])
        self.workout(5, self.dips, [{'reps': 8}])
        self.workout(9, self.bench, [{'weight_kg': '60', 'reps': 10}])
        rows = self.client.get('/api/training/progress/exercises/').json()
        self.assertEqual([(r['exercise']['id'], r['sessions']) for r in rows], [(str(self.bench.id), 2), (str(self.dips.id), 1)])

        self.client.force_authenticate(User.objects.create_user('c@d.rs', 'jaka-lozinka-123'))
        self.assertEqual(self.client.get('/api/training/progress/exercises/').data, [])
        self.assertEqual(self.progress(self.bench)['records'], {})
        custom = Exercise.objects.create(owner=self.user, name='Moja', equipment='other', measurement='duration', muscle='core')
        self.assertEqual(self.client.get(f'/api/training/progress/exercises/{custom.id}/').status_code, 404)
