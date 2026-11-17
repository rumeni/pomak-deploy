import csv
import datetime
import io
import json
import zipfile

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from nutrition.models import Food, MealEntry, NutritionTarget
from progress.models import Goal, Measurement
from training.models import Exercise, Routine, RoutineExercise, SessionExercise, SetLog, WorkoutSession


class ExportDeleteTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        # Lična vežba u rutini i odrađenom treningu (veze su zaštićene od brisanja vežbe).
        self.ex = Exercise.objects.create(owner=self.user, name='Moj čučanj', equipment='barbell', measurement='weight_reps', muscle='legs')
        routine = Routine.objects.create(owner=self.user, name='A')
        RoutineExercise.objects.create(routine=routine, exercise=self.ex, position=0)
        now = timezone.now()
        session = WorkoutSession.objects.create(
            owner=self.user, name='Trening A', started_at=now, finished_at=now,
            sleep_hours=7, motivation=4, stress=2, soreness_upper=1, soreness_lower=3, hydration=5,
        )
        se = SessionExercise.objects.create(session=session, exercise=self.ex, position=0)
        SetLog.objects.create(session_exercise=se, position=0, weight_kg=100, reps=5, rpe=8)
        # A workout without a check-in has no row in spremnost.csv.
        later = now + datetime.timedelta(hours=1)  # export lists oldest first
        WorkoutSession.objects.create(owner=self.user, name='Bez upitnika', started_at=later, finished_at=later)
        sauce = Food.objects.create(owner=self.user, source='custom', name='Sos', kcal=100)
        MealEntry.objects.create(owner=self.user, date=datetime.date(2026, 9, 30), meal='lunch', name='Šnicla', kcal=450, protein_g=None)
        NutritionTarget.objects.create(owner=self.user, valid_from=datetime.date(2026, 9, 30), mode='manual', kcal=2200)
        Measurement.objects.create(user=self.user, kind='weight', value=82.4, measured_on=datetime.date(2026, 9, 30))
        Goal.objects.create(user=self.user, kind='weight', start_value=82.4, target_value=78, start_date=datetime.date(2026, 9, 30))
        self.client.post('/api/nutrition/recipes/', {'name': 'Jelo', 'ingredients': [{'food_id': str(sauce.id), 'grams': '100'}]}, format='json')
        MealEntry.objects.create(owner=self.other, date=datetime.date(2026, 9, 30), meal='lunch', name='Tuđe', kcal=1)

    def test_export_zip_has_all_own_data(self):
        res = self.client.get('/api/auth/me/export/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('pomak-izvoz-', res['Content-Disposition'])
        z = zipfile.ZipFile(io.BytesIO(res.content))
        self.assertEqual(sorted(z.namelist()), ['ishrana.csv', 'merenja.csv', 'pomak.json', 'spremnost.csv', 'treninzi.csv'])
        data = json.loads(z.read('pomak.json'))
        self.assertEqual(data['account']['email'], 'a@b.rs')
        self.assertEqual(data['workouts'][0]['exercises'][0]['sets'][0]['weight_kg'], '100.00')
        self.assertEqual([e['name'] for e in data['nutrition']['entries']], ['Šnicla'])  # bez tuđih podataka
        self.assertIsNone(data['nutrition']['entries'][0]['protein_g'])  # nepoznato ostaje prazno, ne 0
        self.assertEqual(data['nutrition']['targets'][0]['kcal'], 2200)
        self.assertEqual({f['source'] for f in data['nutrition']['foods_and_recipes']}, {'custom', 'recipe'})
        self.assertEqual(data['goals'][0]['target_value'], '78.00')

        rows = list(csv.reader(io.StringIO(z.read('treninzi.csv').decode('utf-8-sig'))))
        self.assertEqual(rows[1][1:7], ['Trening A', 'Moj čučanj', '1', 'working', '100.00', '5'])
        self.assertEqual((rows[0][-1], rows[1][-1]), ('rpe', '8.0'))
        readiness = list(csv.reader(io.StringIO(z.read('spremnost.csv').decode('utf-8-sig'))))
        self.assertEqual(readiness[0][1:], ['trening', 'san_h', 'motivacija', 'stres', 'upala_gornji_deo', 'upala_donji_deo', 'hidratacija'])
        self.assertEqual(readiness[1:], [[readiness[1][0], 'Trening A', '7', '4', '2', '1', '3', '5']])
        workout = next(w for w in data['workouts'] if w['name'] == 'Trening A')
        self.assertEqual(workout['readiness']['sleep_hours'], 7)
        food = list(csv.reader(io.StringIO(z.read('ishrana.csv').decode('utf-8-sig'))))
        self.assertEqual((food[1][2], food[1][5]), ('Šnicla', ''))

    def test_delete_needs_password_and_removes_everything(self):
        res = self.client.post('/api/auth/me/delete/', {'password': 'pogresna'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

        user_id = self.user.pk
        res = self.client.post('/api/auth/me/delete/', {'password': 'jaka-lozinka-123'}, format='json')
        self.assertEqual(res.status_code, 204)
        self.assertFalse(User.objects.filter(pk=user_id).exists())
        for model, field in [(WorkoutSession, 'owner'), (MealEntry, 'owner'), (Food, 'owner'), (Exercise, 'owner'), (Measurement, 'user'), (Goal, 'user')]:
            self.assertFalse(model.objects.filter(**{f'{field}_id': user_id}).exists(), model.__name__)
        # Tuđi podaci i zajednička biblioteka ostaju
        self.assertTrue(MealEntry.objects.filter(owner=self.other).exists())
        self.assertTrue(Exercise.objects.filter(owner__isnull=True).exists())

    def test_non_object_json_in_delete_and_password_change_returns_400(self):
        # Both endpoints share a strict account-sensitive DB throttle.
        # Check each route once: repeated invalid attempts correctly return 429.
        for route in ('/api/auth/me/delete/', '/api/auth/password/change/'):
            with self.subTest(route=route):
                response = self.client.post(route, [], format='json')
                self.assertEqual(response.status_code, 400, response.data)
                self.assertTrue(User.objects.filter(pk=self.user.pk).exists())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('jaka-lozinka-123'))
