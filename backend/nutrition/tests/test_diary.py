import uuid
from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from nutrition.models import Food, MealEntry, NutritionDay

DAY = '2026-09-30'


class DiaryTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.egg = Food.objects.get(slug='egg-raw')  # 143 kcal, 12.56 P, 0.72 UH, 9.51 M na 100 g

    def put(self, entry_id, **body):
        return self.client.put(f'/api/nutrition/entries/{entry_id}/', {'date': DAY, 'meal': 'breakfast', **body}, format='json')

    def day(self, date=DAY):
        return self.client.get(f'/api/nutrition/days/{date}/').data

    def test_entry_from_food_computes_totals_from_snapshot(self):
        eid = uuid.uuid4()
        res = self.put(eid, food_id=str(self.egg.id), grams='100', portion_name='2 jaja')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual((res.data['name'], res.data['kcal'], res.data['protein_g']), ('Jaje (sirovo)', '143.0', '12.56'))
        res = self.put(eid, food_id=str(self.egg.id), grams='50')
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data['kcal'], res.data['fat_g']), ('71.5', '4.76'))

    def test_changing_food_does_not_change_logged_meal(self):
        """AC-04: izmena namirnice ne menja ranije obroke, ni kad se kasnije promeni količina."""
        food = Food.objects.create(owner=self.user, source='custom', name='Pita', kcal=250, fat_g=12)
        eid = uuid.uuid4()
        self.put(eid, food_id=str(food.id), grams='200')
        food.kcal, food.fat_g = Decimal('999'), Decimal('50')
        food.save()
        self.assertEqual(self.day()['entries'][0]['kcal'], '500.0')
        res = self.put(eid, food_id=str(food.id), grams='100')
        self.assertEqual((res.data['kcal'], res.data['fat_g']), ('250.0', '12.00'))

    def test_copy_preserves_historical_per100_after_food_changes(self):
        food = Food.objects.create(owner=self.user, source='custom', name='Pita', kcal=250, fat_g=12)
        original_id, copy_id = uuid.uuid4(), uuid.uuid4()
        original = self.put(original_id, food_id=str(food.id), grams='200', portion_name='2 servings')
        self.assertEqual(original.status_code, 201, original.data)
        snapshot = {f'per100_{field}': original.data[f'per100_{field}'] for field in MealEntry.VALUE_FIELDS}
        food.kcal, food.fat_g = Decimal('300'), Decimal('15')
        food.save()

        copied = self.put(copy_id, food_id=str(food.id), grams='200', portion_name='2 servings', **snapshot)
        self.assertEqual(copied.status_code, 201, copied.data)
        self.assertEqual((copied.data['kcal'], copied.data['fat_g']), ('500.0', '24.00'))
        self.assertEqual(copied.data['per100_kcal'], '250.0')
        self.assertEqual(copied.data['food_id'], str(food.id))

        # An identical retry after a lost HTTP response must be idempotent.
        again = self.put(copy_id, food_id=str(food.id), grams='200', portion_name='2 servings', **snapshot)
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual(MealEntry.objects.count(), 2)

        changed = self.put(copy_id, food_id=str(food.id), grams='200', **{**snapshot, 'per100_kcal': '300.0'})
        self.assertEqual(changed.status_code, 400)
        self.assertEqual(MealEntry.objects.get(pk=copy_id).per100_kcal, Decimal('250.0'))

        # A regular new food entry with no per100 snapshot still uses CURRENT data.
        fresh = self.put(uuid.uuid4(), food_id=str(food.id), grams='200')
        self.assertEqual(fresh.status_code, 201, fresh.data)
        self.assertEqual((fresh.data['kcal'], fresh.data['fat_g']), ('600.0', '30.00'))
        self.assertEqual(original.data['kcal'], '500.0')

    def test_copy_without_server_side_original_succeeds(self):
        """A queued offline copy does not require a previously uploaded original."""
        food = Food.objects.create(owner=self.user, source='custom', name='Pita', kcal=250, fat_g=12)
        copied = self.put(
            uuid.uuid4(), food_id=str(food.id), grams='150',
            per100_kcal='250.0', per100_protein_g=None, per100_carbs_g=None,
            per100_fat_g='12.00', per100_fiber_g=None,
        )
        self.assertEqual(copied.status_code, 201, copied.data)
        self.assertEqual((copied.data['kcal'], copied.data['fat_g']), ('375.0', '18.00'))
        self.assertEqual(MealEntry.objects.count(), 1)

    def test_copied_snapshot_rejects_partial_invalid_or_inaccessible_data(self):
        food = Food.objects.create(owner=self.user, source='custom', name='Pita', kcal=250)
        valid = {
            'food_id': str(food.id), 'grams': '100',
            'per100_kcal': '250.0', 'per100_protein_g': '20.00',
            'per100_carbs_g': '30.00', 'per100_fat_g': '10.00',
            'per100_fiber_g': None,
        }
        for changes in [
            {'per100_fiber_g': 'MISSING'},
            {'per100_kcal': None},
            {'per100_kcal': '-0.1'},
            {'per100_kcal': '900.1'},
            {'per100_protein_g': '100.01'},
            {'per100_fiber_g': '100.01'},
            {'per100_protein_g': '65.00', 'per100_carbs_g': '36.00'},
        ]:
            with self.subTest(changes=changes):
                body = {**valid, **changes}
                if body.get('per100_fiber_g') == 'MISSING':
                    body.pop('per100_fiber_g')
                response = self.put(uuid.uuid4(), **body)
                self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(MealEntry.objects.exists())

        # These fields are not valid as a hidden payload for a manual entry.
        without_food = {**valid, 'food_id': None, 'name': 'Pita', 'kcal': '300'}
        self.assertEqual(self.put(uuid.uuid4(), **without_food).status_code, 400)
        other = User.objects.create_user('other@b.rs', 'jaka-lozinka-123')
        foreign = Food.objects.create(owner=other, source='custom', name='Private', kcal=200)
        self.assertEqual(self.put(uuid.uuid4(), **{**valid, 'food_id': str(foreign.id)}).status_code, 400)
        self.assertFalse(MealEntry.objects.exists())

        # All five keys present with explicitly unknown macro values is valid.
        valid.update(per100_protein_g=None, per100_carbs_g=None, per100_fat_g=None)
        self.assertEqual(self.put(uuid.uuid4(), **valid).status_code, 201)

    def test_entry_survives_deleting_its_custom_food(self):
        food = Food.objects.create(owner=self.user, source='custom', name='Pita', kcal=250)
        eid = uuid.uuid4()
        self.put(eid, food_id=str(food.id), grams='100')
        food.delete()
        res = self.put(eid, food_id=None, grams='200')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual((res.data['name'], res.data['kcal']), ('Pita', '500.0'))

    def test_manual_entry_keeps_unknown_macros_null(self):
        """AC-05: nepoznati makroi nisu nule."""
        res = self.put(uuid.uuid4(), name='Burek iz pekare', kcal='600', fat_g='35')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIsNone(res.data['protein_g'])
        self.assertIsNone(res.data['carbs_g'])
        self.assertIsNone(res.data['grams'])

    def test_resending_same_entry_is_idempotent(self):
        eid = uuid.uuid4()
        self.put(eid, food_id=str(self.egg.id), grams='100')
        self.put(eid, food_id=str(self.egg.id), grams='100')
        self.assertEqual(MealEntry.objects.count(), 1)
        self.assertEqual(self.client.delete(f'/api/nutrition/entries/{eid}/').status_code, 204)
        self.assertEqual(self.client.delete(f'/api/nutrition/entries/{eid}/').status_code, 204)
        self.assertEqual(MealEntry.objects.count(), 0)

    def test_food_of_entry_cannot_change(self):
        eid = uuid.uuid4()
        self.put(eid, food_id=str(self.egg.id), grams='100')
        banana = Food.objects.get(slug='banana')
        self.assertEqual(self.put(eid, food_id=str(banana.id), grams='100').status_code, 400)
        self.assertEqual(self.put(eid, name='Nešto', kcal='100').status_code, 400)

    def test_validation(self):
        self.assertEqual(self.put(uuid.uuid4(), food_id=str(self.egg.id)).status_code, 400)  # nema grama
        self.assertEqual(self.put(uuid.uuid4(), name='X').status_code, 400)  # ručno bez kcal
        self.assertEqual(self.put(uuid.uuid4(), kcal='100').status_code, 400)  # ručno bez naziva
        self.assertEqual(self.put(uuid.uuid4(), food_id=str(self.egg.id), grams='100', meal='brunch').status_code, 400)
        self.assertEqual(self.client.get('/api/nutrition/days/nije-datum/').status_code, 400)

    def test_entries_and_foods_of_other_users_are_off_limits(self):
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        private = Food.objects.create(owner=other, source='custom', name='Tuđa', kcal=100)
        self.assertEqual(self.put(uuid.uuid4(), food_id=str(private.id), grams='100').status_code, 400)

        foreign = MealEntry.objects.create(owner=other, date=DAY, meal='lunch', name='X', kcal=1)
        self.assertEqual(self.put(foreign.id, name='Moje', kcal='5').status_code, 404)
        self.client.delete(f'/api/nutrition/entries/{foreign.id}/')
        self.assertTrue(MealEntry.objects.filter(pk=foreign.id).exists())
        self.assertEqual(self.day()['entries'], [])

    def test_day_status_is_explicit(self):
        """AC-05: dan sa jednim obrokom nije automatski kompletan."""
        self.put(uuid.uuid4(), food_id=str(self.egg.id), grams='100')
        self.assertIsNone(self.day()['status'])
        res = self.client.put(f'/api/nutrition/days/{DAY}/', {'status': 'complete'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.day()['status'], 'complete')
        self.assertEqual(NutritionDay.objects.count(), 1)
        self.assertEqual(self.client.put(f'/api/nutrition/days/{DAY}/', {'status': 'done'}, format='json').status_code, 400)

    def test_recent_foods_newest_first_without_duplicates(self):
        banana = Food.objects.get(slug='banana')
        self.put(uuid.uuid4(), food_id=str(self.egg.id), grams='50')
        self.put(uuid.uuid4(), food_id=str(banana.id), grams='118')
        self.put(uuid.uuid4(), food_id=str(self.egg.id), grams='50')
        names = [f['name'] for f in self.client.get('/api/nutrition/recent-foods/').data]
        self.assertEqual(names, ['Jaje (sirovo)', 'Banana'])
