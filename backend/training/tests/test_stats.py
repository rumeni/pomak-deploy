import uuid
from datetime import datetime, time, timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from training.models import Exercise


class TrainingStatsTests(APITestCase):
    """Statistics and readiness history: what counts, per period, and only for the owner."""

    def setUp(self):
        self.user = User.objects.create_user('stats@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.bench = Exercise.objects.get(slug='bench-press')
        self.curl = Exercise.objects.get(slug='dumbbell-bench-press')  # per-dumbbell load
        self.plank = Exercise.objects.get(slug='plank')
        self.today = timezone.localdate()

    def workout(self, days_ago, exercises, readiness=None):
        start = timezone.make_aware(datetime.combine(self.today - timedelta(days=days_ago), time(18, 0)))
        if days_ago == 0:
            # Today, but never in the future (the API rejects that): before 18:00 use "a minute
            # ago", and right after midnight the day's start.
            midnight = timezone.make_aware(datetime.combine(self.today, time(0, 0)))
            start = min(start, max(midnight, timezone.now() - timedelta(minutes=1)))
        body = {
            'id': str(uuid.uuid4()), 'name': f'T-{days_ago}', 'started_at': start.isoformat(),
            'finished_at': (start + timedelta(hours=1)).isoformat(),
            'exercises': [
                {'exercise_id': str(ex.id), 'notes': '', 'sets': [
                    {'set_type': 'working', 'completed_at': start.isoformat(), **s} for s in sets
                ]}
                for ex, sets in exercises
            ],
        }
        if readiness:
            body['readiness'] = readiness
        res = self.client.post('/api/training/sessions/', body, format='json')
        self.assertEqual(res.status_code, 201, res.data)

    def stats(self, period='30'):
        res = self.client.get('/api/training/stats/', {'period': period})
        self.assertEqual(res.status_code, 200, res.data)
        return res.json()

    def test_totals_count_only_working_sets_and_weighted_volume(self):
        self.workout(1, [
            (self.bench, [{'weight_kg': '100', 'reps': 5, 'rpe': 8}, {'weight_kg': '60', 'reps': 10, 'set_type': 'warmup'}]),
            (self.curl, [{'weight_kg': '20', 'reps': 10, 'rpe': 7}]),
            (self.plank, [{'duration_seconds': 60}]),
        ])
        data = self.stats()
        # 3 working sets; warm-up out. Volume 100x5 + 20x10x2 (per dumbbell) = 900; plank adds none.
        self.assertEqual(data['totals'], {
            'sessions': 1, 'working_sets': 3, 'volume_kg': '900', 'avg_rpe': '7.5', 'rpe_sets': 2, 'rpe_sum': '15.0',
        })
        self.assertEqual({m['muscle']: m['working_sets'] for m in data['muscles']}, {'chest': 2, 'core': 1})

    def test_periods_and_comparison_with_the_previous_period(self):
        self.workout(2, [(self.bench, [{'weight_kg': '100', 'reps': 5}])])
        self.workout(10, [(self.bench, [{'weight_kg': '90', 'reps': 5}] * 2)])
        self.workout(40, [(self.bench, [{'weight_kg': '80', 'reps': 5}] * 3)])
        week = self.stats('7')
        self.assertEqual((week['totals']['sessions'], week['previous']['sessions']), (1, 1))
        self.assertEqual(self.stats('30')['totals']['working_sets'], 3)
        self.assertEqual(self.stats('30')['previous']['working_sets'], 3)  # day 40 is in days 31-60
        everything = self.stats('all')
        self.assertEqual(everything['totals']['sessions'], 3)
        self.assertIsNone(everything['previous'])
        self.assertIsNone(everything['first_day'])

    def test_weeks_include_empty_weeks_up_to_this_one(self):
        self.workout(0, [(self.bench, [{'weight_kg': '100', 'reps': 5}])])
        weeks = self.stats('90')['weeks']
        self.assertGreaterEqual(len(weeks), 13)
        self.assertEqual(weeks[-1]['working_sets'], 1)
        self.assertEqual(sum(w['sessions'] for w in weeks), 1)
        monday = self.today - timedelta(days=self.today.weekday())
        self.assertEqual(weeks[-1]['week_start'], monday.isoformat())

    def test_top_lifts_use_estimated_1rm_and_flag_personal_bests(self):
        self.workout(60, [(self.bench, [{'weight_kg': '110', 'reps': 3, 'rpe': 9}])])  # older all-time best
        self.workout(3, [(self.bench, [{'weight_kg': '100', 'reps': 5, 'rpe': 8}])])
        lift = self.stats('30')['top_lifts'][0]
        self.assertEqual((lift['exercise_id'], lift['e1rm'], lift['reps'], lift['rpe']), (str(self.bench.id), '123.5', 5, '8.0'))
        self.assertFalse(lift['personal_best'])  # 110 x 3 @ 9 = 123.6 is higher
        self.workout(1, [(self.bench, [{'weight_kg': '105', 'reps': 5, 'rpe': 8}])])
        self.assertTrue(self.stats('30')['top_lifts'][0]['personal_best'])

    def test_readiness_history_lists_check_ins_with_what_was_done(self):
        self.workout(5, [(self.bench, [{'weight_kg': '100', 'reps': 5, 'rpe': 9}])], readiness={'sleep_hours': 5, 'stress': 4})
        self.workout(3, [(self.bench, [{'weight_kg': '100', 'reps': 5}])])  # no check-in
        self.workout(1, [(self.bench, [{'weight_kg': '100', 'reps': 5, 'rpe': 7}] * 2)], readiness={'sleep_hours': 8, 'motivation': 5})
        entries = self.stats()['readiness']
        self.assertEqual([e['readiness']['sleep_hours'] for e in entries], [5, 8])
        self.assertEqual([(e['working_sets'], e['avg_rpe']) for e in entries], [(1, '9.0'), (2, '7.0')])

    def test_only_own_workouts_and_valid_periods(self):
        other = User.objects.create_user('drugi@b.rs', 'jaka-lozinka-123')
        self.workout(1, [(self.bench, [{'weight_kg': '100', 'reps': 5}])])
        self.client.force_authenticate(other)
        self.assertEqual(self.stats()['totals']['sessions'], 0)
        self.assertEqual(self.client.get('/api/training/stats/', {'period': '365'}).status_code, 400)

    def test_exercise_progress_has_an_e1rm_series_per_workout(self):
        self.workout(3, [(self.bench, [{'weight_kg': '100', 'reps': 5, 'rpe': 8}, {'weight_kg': '90', 'reps': 12}])])
        self.workout(1, [(self.bench, [{'weight_kg': '60', 'reps': 20}])])  # nothing estimable
        data = self.client.get(f'/api/training/progress/exercises/{self.bench.id}/').json()
        self.assertEqual([p['value'] for p in data['e1rm_chart']], ['123.5'])

    def test_days_cover_the_real_period_and_long_history_caps_only_the_chart(self):
        # A year of history: weekly rates must use ~365 days, not the 26 bars shown.
        self.workout(364, [(self.bench, [{'weight_kg': '60', 'reps': 5}])])
        self.workout(0, [(self.bench, [{'weight_kg': '60', 'reps': 5}])])
        everything = self.stats('all')
        self.assertEqual(everything['days'], 365)
        self.assertEqual(len(everything['weeks']), 26)
        self.assertTrue(everything['weeks_capped'])
        self.assertEqual(everything['totals']['working_sets'], 2)
        # Seven days are one week of training even when they cross a Monday (two bars).
        week = self.stats('7')
        self.assertEqual(week['days'], 7)
        self.assertFalse(week['weeks_capped'])

    def test_exact_rpe_sum_and_per_side_flag(self):
        self.workout(1, [(self.curl, [{'weight_kg': '20', 'reps': 10, 'rpe': 7.5}, {'weight_kg': '20', 'reps': 10, 'rpe': 8}])])
        self.workout(2, [(self.curl, [{'weight_kg': '18', 'reps': 10, 'rpe': 8.5}] * 3)])
        data = self.stats()
        self.assertEqual([(e['rpe_sum'], e['rpe_sets'], e['avg_rpe']) for e in data['readiness']], [])
        self.assertTrue(data['top_lifts'][0]['per_side'])
        weeks_rpe = sum(float(w['rpe_sum']) for w in data['weeks'])
        self.assertEqual(weeks_rpe, 41.0)

