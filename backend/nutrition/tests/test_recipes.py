import uuid

from rest_framework.test import APITestCase

from accounts.models import User
from nutrition.models import Food, MealEntry

URL = '/api/nutrition/recipes/'


class RecipeTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.rice = Food.objects.get(slug='rice-white-raw')  # 365 kcal, P 7.13, UH 79.95, M 0.66, V 1.30
        self.oil = Food.objects.get(slug='olive-oil')  # 884 kcal, M 100

    def body(self, **extra):
        return {
            'name': 'Pirinač na ulju',
            'mass_g': '600',
            'servings': 3,
            'ingredients': [
                {'food_id': str(self.rice.id), 'grams': '200', 'portion_name': ''},
                {'food_id': str(self.oil.id), 'grams': '10', 'portion_name': '1 kašika'},
            ],
            **extra,
        }

    def create(self, **extra):
        res = self.client.post(URL, self.body(**extra), format='json')
        self.assertEqual(res.status_code, 201, res.data)
        return res.data

    def test_values_per_100g_of_cooked_dish(self):
        recipe = self.create()
        # 200 g pirinča + 10 g ulja = 818,4 kcal u 600 g kuvanog jela
        self.assertEqual(
            [recipe[f] for f in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')],
            ['136.4', '2.38', '26.65', '1.89', '0.43'],
        )
        self.assertEqual(recipe['portions'], [{'name': '1 porcija', 'grams': '200.00'}])
        self.assertEqual(recipe['raw_mass_g'], '210.0')
        self.assertEqual(recipe['ingredients'][1]['food']['name'], self.oil.name)

    def test_without_cooked_mass_uses_sum_of_ingredients(self):
        recipe = self.create(mass_g=None, servings=1)
        self.assertEqual(recipe['kcal'], '389.7')
        self.assertEqual(recipe['portions'][0]['grams'], '210.00')

    def test_unknown_value_in_any_ingredient_is_unknown_in_recipe(self):
        sauce = Food.objects.create(owner=self.user, source='custom', name='Sos', kcal=100, protein_g=None, fat_g=5)
        recipe = self.create(ingredients=[
            {'food_id': str(self.rice.id), 'grams': '100'},
            {'food_id': str(sauce.id), 'grams': '50'},
        ])
        self.assertIsNone(recipe['protein_g'])
        self.assertIsNone(recipe['carbs_g'])
        self.assertIsNotNone(recipe['fat_g'])

    def test_recipe_is_a_food_in_search_and_diary_keeps_snapshot(self):
        recipe = self.create()
        found = self.client.get('/api/nutrition/foods/', {'q': 'pirinac na'}).data
        self.assertEqual((found[0]['id'], found[0]['source']), (recipe['id'], 'recipe'))

        entry_id = uuid.uuid4()
        res = self.client.put(
            f'/api/nutrition/entries/{entry_id}/',
            {'date': '2026-09-30', 'meal': 'lunch', 'food_id': recipe['id'], 'grams': '200', 'portion_name': '1 porcija'},
            format='json',
        )
        self.assertEqual(res.data['kcal'], '272.8')
        # Izmena recepta ne menja već upisan obrok (AC-04)
        res = self.client.patch(f"{URL}{recipe['id']}/", {'mass_g': '400'}, format='json')
        self.assertEqual(res.data['kcal'], '204.6')
        self.assertEqual(str(MealEntry.objects.get(pk=entry_id).kcal), '272.8')

    def test_editing_ingredient_food_recomputes_recipe(self):
        sauce = Food.objects.create(owner=self.user, source='custom', name='Sos', kcal=100)
        recipe = self.create(mass_g=None, servings=1, ingredients=[{'food_id': str(sauce.id), 'grams': '100'}])
        self.assertEqual(recipe['kcal'], '100.0')
        self.client.patch(f'/api/nutrition/foods/{sauce.id}/', {'kcal': '200'}, format='json')
        self.assertEqual(self.client.get(f"{URL}{recipe['id']}/").data['kcal'], '200.0')

    def test_edit_food_that_would_invalidate_recipe_is_rejected_atomically(self):
        sauce = Food.objects.create(owner=self.user, source='custom', name='Sos', kcal=100)
        recipe = self.create(mass_g='50', servings=1, ingredients=[{'food_id': str(sauce.id), 'grams': '100'}])
        self.assertEqual(recipe['kcal'], '200.0')
        res = self.client.patch(f'/api/nutrition/foods/{sauce.id}/', {'kcal': '500'}, format='json')
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(str(Food.objects.get(pk=sauce.id).kcal), '100.0')
        self.assertEqual(self.client.get(f"{URL}{recipe['id']}/").data['kcal'], '200.0')

    def test_validation(self):
        post = lambda b: self.client.post(URL, b, format='json')  # noqa: E731
        self.assertEqual(post(self.body(ingredients=[])).status_code, 400)
        self.assertEqual(post(self.body(name=' ')).status_code, 400)
        # 10 g ulja u "5 g" jela je nemoguće (177 g masti na 100 g)
        res = post(self.body(mass_g='5'))
        self.assertEqual(res.status_code, 400)
        self.assertIn('mass_g', res.data)
        other = self.create()
        res = post(self.body(ingredients=[{'food_id': other['id'], 'grams': '100'}]))
        self.assertEqual(res.status_code, 400)

    def test_recipe_values_cannot_be_overwritten_through_foods(self):
        recipe = self.create()
        res = self.client.patch(f"/api/nutrition/foods/{recipe['id']}/", {'kcal': '10'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_idempotent_private_and_delete_archives(self):
        body = self.body(id=str(uuid.uuid4()))
        self.client.post(URL, body, format='json')
        self.assertEqual(self.client.post(URL, body, format='json').status_code, 200)
        self.assertEqual(Food.objects.filter(source='recipe').count(), 1)

        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(URL).data, [])
        self.assertEqual(self.client.delete(f"{URL}{body['id']}/").status_code, 404)

        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.delete(f"{URL}{body['id']}/").status_code, 204)
        self.assertEqual(self.client.get(URL).data, [])
        self.assertIsNotNone(Food.objects.get(pk=body['id']).archived_at)

    def test_deleting_account_removes_recipes_and_own_foods(self):
        sauce = Food.objects.create(owner=self.user, source='custom', name='Sos', kcal=100)
        self.create(ingredients=[{'food_id': str(sauce.id), 'grams': '100'}], mass_g=None)
        self.user.delete()
        self.assertFalse(Food.objects.filter(owner__isnull=False).exists())

    def test_edit_recipe_cannot_overwrite_shared_or_another_users_food(self):
        other = User.objects.create_user('other@example.test', 'jaka-lozinka-123')
        private_food = Food.objects.create(
            owner=other, source=Food.Source.CUSTOM, name='Other private food', kcal=120,
        )
        for victim in (self.rice, private_food):
            for method in ('patch', 'put'):
                with self.subTest(victim=str(victim.pk), method=method):
                    own_recipe = self.create()
                    original_victim = Food.objects.get(pk=victim.pk)
                    original_owner = original_victim.owner_id
                    original_source = original_victim.source
                    original_name = original_victim.name
                    body = {'id': str(victim.pk), 'name': 'Updated own recipe'}
                    if method == 'put':
                        body = self.body(id=str(victim.pk), name='Updated own recipe')
                    result = getattr(self.client, method)(
                        f"{URL}{own_recipe['id']}/", body, format='json',
                    )
                    self.assertEqual(result.status_code, 200, result.data)
                    self.assertEqual(result.data['id'], own_recipe['id'])
                    own = Food.objects.get(pk=own_recipe['id'])
                    self.assertEqual(own.owner_id, self.user.pk)
                    self.assertEqual(own.source, Food.Source.RECIPE)
                    self.assertEqual(own.name, 'Updated own recipe')
                    untouched = Food.objects.get(pk=victim.pk)
                    self.assertEqual(untouched.owner_id, original_owner)
                    self.assertEqual(untouched.source, original_source)
                    self.assertEqual(untouched.name, original_name)
