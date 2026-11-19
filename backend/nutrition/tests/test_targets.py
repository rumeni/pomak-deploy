import datetime

from unittest import mock

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
    def test_msj_v2_steps_fat_loss(self):
        r = targets.estimate(inputs(goal='fat_loss'))
        # 39 god: BMR = 700 + 1031,25 − 195 − 161 = 1375,25; ×1,55 = 2131,6; −0,35 kg/ned = −385 kcal/dan
        self.assertEqual(r['explanation']['bmr'], 1375)
        self.assertEqual(r['explanation']['tdee'], 2132)
        self.assertEqual(r['explanation']['daily_adjustment'], -385)
        self.assertEqual(r['explanation']['weekly_change_kg'], -0.35)
        # Proteini: 70 kg je iznad referentne težine (BMI 25 pri 165 cm = 68,06 kg):
        # 68,06 + 0,4 × 1,94 = 68,84 kg × 2,0 g = 137,7 → 138 g. Masti 25 %: 48,6 → 49 g.
        self.assertEqual((r['kcal'], r['protein_g'], r['fat_g'], r['carbs_g']), (1750, 138, 49, 189))
        self.assertEqual((r['method'], r['inputs']['age'], r['inputs']['goal']), ('msj-v2', 39, 'fat_loss'))
        self.assertEqual((r['explanation']['protein_g_per_kg'], r['explanation']['protein_weight_kg']), (2.0, 68.8))
        self.assertTrue(r['explanation']['protein_weight_adjusted'])

    def test_each_goal(self):
        base = dict(sex='male', birth_date=datetime.date(2000, 1, 1), height_cm=180.0, weight_kg=80.0, activity='sedentary')
        # BMR = 800 + 1125 − 150 + 5 = 1780; ×1,2 = 2136 → 2140. 80 kg < 81 kg (BMI 25): stvarna težina.
        maintenance = targets.estimate(inputs(**base, goal='maintenance', pace=0.0))
        self.assertEqual((maintenance['kcal'], maintenance['protein_g'], maintenance['explanation']['daily_adjustment']), (2140, 128, 0))
        gain = targets.estimate(inputs(**base, goal='muscle_gain', pace=0.25))
        # +0,2 kg/ned = +220 kcal/dan → 2356 → 2360; proteini 1,8 × 80 = 144.
        self.assertEqual((gain['kcal'], gain['protein_g'], gain['explanation']['weekly_change_kg']), (2360, 144, 0.2))
        recomp = targets.estimate(inputs(**base, goal='recomposition', pace=0.0))
        # Održavanje, bez cilja promene težine; proteini 2,0 × 80 = 160.
        self.assertEqual((recomp['kcal'], recomp['protein_g']), (2140, 160))
        self.assertEqual((recomp['explanation']['daily_adjustment'], recomp['explanation']['weekly_change_kg'], recomp['inputs']['pace']), (0, 0.0, 0.0))
        self.assertFalse(recomp['explanation']['protein_weight_adjusted'])

    def test_legacy_goals_keep_the_earlier_method_exactly(self):
        # An older app shows and saves msj-v1: the very numbers of the original v1 example.
        r = targets.estimate(inputs(goal='lose'))
        self.assertEqual((r['kcal'], r['protein_g'], r['fat_g'], r['carbs_g']), (1750, 112, 49, 215))
        self.assertEqual((r['method'], r['inputs']['goal'], r['explanation']['protein_g_per_kg']), ('msj-v1', 'lose', 1.6))
        self.assertEqual(targets.estimate(inputs(goal='maintain', pace=0.0))['method'], 'msj-v1')
        self.assertEqual(targets.estimate(inputs(goal='gain', pace=0.1))['inputs']['goal'], 'gain')

    def test_protein_weight_is_continuous_and_never_jumps(self):
        reference = 25 * 1.8 ** 2  # 81 kg pri 180 cm
        self.assertEqual(targets.protein_weight(reference, 180), reference)
        self.assertAlmostEqual(targets.protein_weight(reference + 0.01, 180), reference + 0.004, places=6)
        self.assertEqual(targets.protein_weight(70, 180), 70)  # ispod: stvarna težina
        # Bez skoka i oko BMI 30 (97,2 kg): male promene težine daju male promene.
        below, above = targets.protein_weight(97.1, 180), targets.protein_weight(97.3, 180)
        self.assertLess(above - below, 0.1)
        # 120 kg, 180 cm: 81 + 0,4 × 39 = 96,6 kg → 2,0 g/kg ≈ 193 g umesto 240 g.
        r = targets.estimate(inputs(sex='male', birth_date=datetime.date(1990, 1, 1), height_cm=180.0, weight_kg=120.0,
                                    activity='moderate', goal='fat_loss', pace=0.5))
        self.assertEqual((r['protein_g'], r['explanation']['protein_weight_kg']), (193, 96.6))
        # Tačno na referentnoj težini: nije prilagođeno.
        at_reference = targets.estimate(inputs(height_cm=180.0, weight_kg=81.0, goal='maintenance', pace=0.0))
        self.assertFalse(at_reference['explanation']['protein_weight_adjusted'])

    def test_male_maintain_legacy_value(self):
        r = targets.estimate(inputs(sex='male', birth_date=datetime.date(2000, 1, 1), height_cm=180.0, weight_kg=80.0, activity='sedentary', goal='maintain', pace=0.0))
        # BMR = 800 + 1125 − 150 + 5 = 1780; ×1,2 = 2136 → 2140
        self.assertEqual((r['explanation']['daily_adjustment'], r['kcal']), (0, 2140))

    def test_negative_rounding_and_raw_negative_carbs(self):
        self.assertEqual(targets.round_half_up(-1.0), -1)
        self.assertEqual(targets.round_half_up(-0.6), -1)
        self.assertEqual(targets.round_half_up(-1.6), -2)
        # The guard stays: protein and fat above the target is refused, never a hidden 0.
        with mock.patch.dict(targets.GOALS['fat_loss'], {'protein_g_per_kg': 6.0}):
            result = targets.estimate(inputs(goal='fat_loss'))
        self.assertEqual(result, {'supported': False, 'reason': 'macros'})

    def test_unsupported_profiles(self):
        self.assertEqual(targets.estimate(inputs(birth_date=datetime.date(2013, 1, 1)))['reason'], 'age')
        low = targets.estimate(inputs(weight_kg=45.0, height_cm=150.0, birth_date=datetime.date(1970, 1, 1), activity='sedentary', pace=1.0))
        self.assertEqual((low['supported'], low['reason'], low['floor']), (False, 'below_floor', 1200))


class TargetApiBase(APITestCase):
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


class TargetApiTests(TargetApiBase):
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


class GoalApiTests(TargetApiBase):
    def test_recomposition_has_no_pace_and_legacy_values_still_work(self):
        response = self.client.post('/api/nutrition/targets/estimate/', {**self.app_body(goal='recomposition', pace=0.5), 'valid_from': FUTURE}, format='json')
        self.assertEqual(response.status_code, 400)  # no weight-change pace for recomposition
        ok = self.client.post('/api/nutrition/targets/estimate/', {**self.app_body(goal='recomposition', pace=0), 'valid_from': FUTURE}, format='json')
        self.assertEqual((ok.status_code, ok.data['inputs']['goal'], ok.data['explanation']['weekly_change_kg']), (200, 'recomposition', 0.0))
        # An older app sends "lose": it saves exactly what its estimate showed (msj-v1).
        shown = self.client.post('/api/nutrition/targets/estimate/', {**self.app_body(goal='lose'), 'valid_from': FUTURE}, format='json').data
        self.assertEqual(self.client.put(f'/api/nutrition/targets/{FUTURE}/', self.app_body(goal='lose'), format='json').status_code, 200)
        saved = NutritionTarget.objects.get(owner=self.user)
        self.assertEqual((saved.method, saved.inputs['goal'], saved.kcal, saved.protein_g), ('msj-v1', 'lose', shown['kcal'], shown['protein_g']))
        self.assertEqual(self.client.post('/api/nutrition/targets/estimate/', {**self.app_body(goal='bulk'), 'valid_from': FUTURE}, format='json').status_code, 400)

    def test_earlier_targets_stay_as_they_were(self):
        NutritionTarget.objects.create(owner=self.user, valid_from=datetime.date(2026, 1, 1), mode='app', kcal=1800, protein_g=112,
                                       carbs_g=200, fat_g=50, method='msj-v1', inputs={'goal': 'lose', 'pace': 0.5},
                                       explanation={'protein_g_per_kg': 1.6})
        row = next(t for t in self.client.get('/api/nutrition/targets/').data if t['valid_from'] == '2026-01-01')
        self.assertEqual((row['method'], row['inputs']['goal'], row['protein_g'], row['kcal']), ('msj-v1', 'lose', 112, 1800))

    def test_an_accepted_proposal_is_saved_only_as_shown(self):
        shown = self.client.post('/api/nutrition/targets/estimate/', {**self.app_body(goal='fat_loss'), 'valid_from': FUTURE}, format='json').data
        expected = {f: shown[f] for f in ('method', 'kcal', 'protein_g', 'carbs_g', 'fat_g')}
        # The weight changed after the proposal was shown (another device): not saved.
        Measurement.objects.create(user=self.user, kind='weight', value=80, measured_on=datetime.date(2026, 9, 25))
        stale = self.client.put(f'/api/nutrition/targets/{FUTURE}/', {**self.app_body(goal='fat_loss'), 'expected': expected}, format='json')
        self.assertEqual((stale.status_code, stale.data['code']), (409, 'estimate_changed'))
        self.assertFalse(NutritionTarget.objects.filter(owner=self.user).exists())
        fresh = {f: stale.data['estimate'][f] for f in expected}
        ok = self.client.put(f'/api/nutrition/targets/{FUTURE}/', {**self.app_body(goal='fat_loss'), 'expected': fresh}, format='json')
        self.assertEqual(ok.status_code, 200)


    def test_new_goals_require_complete_expected_proposal(self):
        url = f'/api/nutrition/targets/{FUTURE}/'
        body = self.app_body(goal='fat_loss')
        shown = self.client.post('/api/nutrition/targets/estimate/', {**body, 'valid_from': FUTURE}, format='json').data
        expected = {f: shown[f] for f in ('method', 'kcal', 'protein_g', 'carbs_g', 'fat_g')}
        self.assertEqual(self.client.put(url, body, format='json').status_code, 400)
        self.assertEqual(self.client.put(url, {**body, 'expected': {'kcal': shown['kcal']}}, format='json').status_code, 400)
        stale = self.client.put(url, {**body, 'expected': {**expected, 'method': 'msj-v1'}}, format='json')
        self.assertEqual((stale.status_code, stale.data['code']), (409, 'estimate_changed'))
        self.assertFalse(NutritionTarget.objects.exists())
        self.assertEqual(self.client.put(url, {**body, 'expected': expected}, format='json').status_code, 200)

    def test_proposal_that_becomes_unsupported_is_not_saved(self):
        body = self.app_body(goal='fat_loss')
        shown = self.client.post('/api/nutrition/targets/estimate/', {**body, 'valid_from': FUTURE}, format='json').data
        expected = {f: shown[f] for f in ('method', 'kcal', 'protein_g', 'carbs_g', 'fat_g')}
        self.user.profile.height_cm = None
        self.user.profile.save()
        stale = self.client.put(f'/api/nutrition/targets/{FUTURE}/', {**body, 'expected': expected}, format='json')
        self.assertEqual((stale.status_code, stale.data['code']), (409, 'estimate_changed'))
        self.assertEqual(stale.data['estimate']['reason'], 'missing')
        self.assertFalse(NutritionTarget.objects.exists())
