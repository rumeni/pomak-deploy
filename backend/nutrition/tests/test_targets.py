import datetime

from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from nutrition import targets
from nutrition.models import NutritionTarget
from progress.models import Measurement

FUTURE = '2030-01-01'


def inputs(**extra):
    base = dict(
        sex='female', birth_date=datetime.date(1990, 6, 15), height_cm=165.0, weight_kg=70.0,
        weight_date=datetime.date(2029, 12, 30), activity='moderate', goal='lose', pace=0.5,
        valid_from=datetime.date(2030, 1, 1),
    )
    return targets.Inputs(**{**base, **extra})


class MethodTests(SimpleTestCase):
    def test_msj_v1_steps(self):
        r = targets.estimate(inputs())
        # 39 god: BMR = 700 + 1031,25 − 195 − 161 = 1375,25; ×1,55 = 2131,6; −0,35 kg/ned = −385 kcal/dan
        self.assertEqual(r['explanation']['bmr'], 1375)
        self.assertEqual(r['explanation']['tdee'], 2132)
        self.assertEqual(r['explanation']['daily_adjustment'], -385)
        self.assertEqual(r['explanation']['weekly_change_kg'], -0.35)
        self.assertEqual((r['kcal'], r['protein_g'], r['fat_g'], r['carbs_g']), (1750, 112, 49, 215))
        self.assertEqual((r['method'], r['inputs']['age']), ('msj-v1', 39))

    def test_male_maintain(self):
        r = targets.estimate(inputs(sex='male', birth_date=datetime.date(2000, 1, 1), height_cm=180.0, weight_kg=80.0, activity='sedentary', goal='maintain', pace=0.0))
        # BMR = 800 + 1125 − 150 + 5 = 1780; ×1,2 = 2136 → 2140
        self.assertEqual((r['explanation']['daily_adjustment'], r['kcal']), (0, 2140))

    def test_negative_rounding_and_raw_negative_carbs(self):
        self.assertEqual(targets.round_half_up(-1.0), -1)
        self.assertEqual(targets.round_half_up(-0.6), -1)
        self.assertEqual(targets.round_half_up(-1.6), -2)
        result = targets.estimate(inputs(
            sex='female', birth_date=datetime.date(1960, 1, 1),
            height_cm=120, weight_kg=142, activity='sedentary',
            goal='lose', pace=0.5,
        ))
        self.assertEqual(result, {'supported': False, 'reason': 'macros'})

    def test_unsupported_profiles(self):
        self.assertEqual(targets.estimate(inputs(birth_date=datetime.date(2013, 1, 1)))['reason'], 'age')
        low = targets.estimate(inputs(weight_kg=45.0, height_cm=150.0, birth_date=datetime.date(1970, 1, 1), activity='sedentary', pace=1.0))
        self.assertEqual((low['supported'], low['reason'], low['floor']), (False, 'below_floor', 1200))


class TargetApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        p = self.user.profile
        p.sex, p.birth_date, p.height_cm = 'female', datetime.date(1990, 6, 15), 165
        p.save()
        Measurement.objects.create(user=self.user, kind='weight', value=72, measured_on=datetime.date(2026, 9, 1))
        Measurement.objects.create(user=self.user, kind='weight', value=70, measured_on=datetime.date(2026, 9, 20))

    def app_body(self, **extra):
        return {'mode': 'app', 'activity': 'moderate', 'goal': 'lose', 'pace': 0.5, 'special_conditions': False, **extra}

    def test_estimate_uses_profile_and_latest_weight_and_saves_nothing(self):
        res = self.client.post('/api/nutrition/targets/estimate/', {**self.app_body(), 'valid_from': FUTURE}, format='json')
        self.assertEqual((res.data['kcal'], res.data['inputs']['weight_kg'], res.data['inputs']['weight_date']), (1750, 70.0, '2026-09-20'))
        self.assertFalse(NutritionTarget.objects.exists())

    def test_unsupported_gets_no_automatic_target(self):
        est = lambda b: self.client.post('/api/nutrition/targets/estimate/', b, format='json').data  # noqa: E731
        self.assertEqual(est(self.app_body(special_conditions=True))['reason'], 'special_conditions')
        self.user.profile.height_cm = None
        self.user.profile.save()
        self.assertEqual(est(self.app_body())['missing'], ['height'])
        res = self.client.put(f'/api/nutrition/targets/{FUTURE}/', self.app_body(), format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(NutritionTarget.objects.exists())

    def test_app_target_saved_with_inputs_method_and_author(self):
        res = self.client.put(f'/api/nutrition/targets/{FUTURE}/', self.app_body(kcal=5000), format='json')
        self.assertEqual(res.status_code, 200, res.data)
        t = NutritionTarget.objects.get()
        # Server računa sam; poslati broj kalorija se ignoriše
        self.assertEqual((t.kcal, t.method, t.mode, t.set_by, t.inputs['activity']), (1750, 'msj-v1', 'app', self.user, 'moderate'))

    def test_one_target_per_date_and_history_kept(self):
        today = timezone.localdate()
        later = today + datetime.timedelta(days=10)
        self.client.put(f'/api/nutrition/targets/{today}/', {'mode': 'manual', 'kcal': 2000}, format='json')
        self.client.put(f'/api/nutrition/targets/{today}/', {'mode': 'manual', 'kcal': 2100, 'protein_g': 150}, format='json')
        self.client.put(f'/api/nutrition/targets/{later}/', {'mode': 'manual', 'kcal': 1900}, format='json')
        self.assertEqual([t['kcal'] for t in self.client.get('/api/nutrition/targets/').data], [1900, 2100])

        day = lambda d: self.client.get(f'/api/nutrition/days/{d}/').data['target']  # noqa: E731
        self.assertIsNone(day(today - datetime.timedelta(days=1)))
        self.assertEqual(day(today)['kcal'], 2100)
        self.assertEqual(day(later - datetime.timedelta(days=1))['protein_g'], 150)
        self.assertEqual(day(later)['kcal'], 1900)

    def test_past_start_and_invalid_manual_rejected(self):
        past = timezone.localdate() - datetime.timedelta(days=5)
        self.assertEqual(self.client.put(f'/api/nutrition/targets/{past}/', {'mode': 'manual', 'kcal': 2000}, format='json').status_code, 400)
        put = lambda b: self.client.put(f'/api/nutrition/targets/{FUTURE}/', b, format='json').status_code  # noqa: E731
        self.assertEqual(put({'mode': 'manual'}), 400)
        self.assertEqual(put({'mode': 'manual', 'kcal': 1500, 'protein_g': 300, 'fat_g': 100}), 400)
        self.assertEqual(put({'mode': 'coach', 'kcal': 2000}), 400)
        self.assertEqual(put(self.app_body(pace=0.3)), 400)

    def test_targets_are_private(self):
        self.client.put(f'/api/nutrition/targets/{FUTURE}/', {'mode': 'manual', 'kcal': 2000}, format='json')
        self.client.force_authenticate(User.objects.create_user('c@d.rs', 'jaka-lozinka-123'))
        self.assertEqual(self.client.get('/api/nutrition/targets/').data, [])
        self.assertIsNone(self.client.get(f'/api/nutrition/days/{FUTURE}/').data['target'])
