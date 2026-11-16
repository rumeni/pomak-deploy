import uuid

from rest_framework.test import APITestCase

from accounts.models import User
from nutrition.models import Food, SavedMeal


class SavedMealTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.egg = Food.objects.get(slug='egg-boiled')
        self.bread = Food.objects.get(slug='bread-whole-wheat')

    def body(self, **extra):
        return {
            'name': 'Moj doručak',
            'items': [
                {'food_id': str(self.egg.id), 'grams': '100', 'portion_name': '2 jaja'},
                {'food_id': str(self.bread.id), 'grams': '64', 'portion_name': ''},
                {'name': 'Kafa sa mlekom', 'kcal': '40', 'protein_g': None, 'fat_g': '2'},
            ],
            **extra,
        }

    def test_create_and_list_with_food_details(self):
        res = self.client.post('/api/nutrition/saved-meals/', self.body(id=str(uuid.uuid4())), format='json')
        self.assertEqual(res.status_code, 201, res.data)
        meal = self.client.get('/api/nutrition/saved-meals/').data[0]
        self.assertEqual(meal['name'], 'Moj doručak')
        self.assertEqual(meal['items'][0]['food']['name'], 'Jaje, tvrdo kuvano')
        self.assertEqual(meal['items'][0]['food']['portions'][0]['name'], '1 jaje (veliko)')
        # Stavka iz namirnice ne čuva vrednosti (uzimaju se pri dodavanju u dnevnik)
        self.assertIsNone(meal['items'][0]['kcal'])
        self.assertEqual((meal['items'][2]['name'], meal['items'][2]['kcal'], meal['items'][2]['protein_g']), ('Kafa sa mlekom', '40.0', None))

    def test_idempotent_and_private(self):
        body = self.body(id=str(uuid.uuid4()))
        self.client.post('/api/nutrition/saved-meals/', body, format='json')
        self.assertEqual(self.client.post('/api/nutrition/saved-meals/', body, format='json').status_code, 200)
        self.assertEqual(SavedMeal.objects.count(), 1)
        self.client.force_authenticate(User.objects.create_user('c@d.rs', 'jaka-lozinka-123'))
        self.assertEqual(self.client.get('/api/nutrition/saved-meals/').data, [])

    def test_exact_retry_after_server_trims_text_remains_idempotent(self):
        mid = str(uuid.uuid4())
        body = self.body(id=mid, name='  Moj doručak  ')
        body['items'][0]['portion_name'] = '  2 jaja  '
        first = self.client.post('/api/nutrition/saved-meals/', body, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data['name'], 'Moj doručak')
        retried = self.client.post('/api/nutrition/saved-meals/', body, format='json')
        self.assertEqual(retried.status_code, 200, retried.data)
        self.assertEqual(SavedMeal.objects.count(), 1)

    def test_changed_retry_returns_conflict_instead_of_false_success(self):
        meal_id = str(uuid.uuid4())
        original = self.body(id=meal_id, name='First breakfast')
        self.assertEqual(self.client.post('/api/nutrition/saved-meals/', original, format='json').status_code, 201)
        self.assertEqual(self.client.post('/api/nutrition/saved-meals/', original, format='json').status_code, 200)
        changed = self.client.post('/api/nutrition/saved-meals/', self.body(id=meal_id, name='Changed breakfast'), format='json')
        self.assertEqual(changed.status_code, 409, changed.data)
        self.assertEqual(SavedMeal.objects.get(pk=meal_id).name, 'First breakfast')
        self.assertEqual(SavedMeal.objects.count(), 1)

    def test_validation(self):
        post = lambda b: self.client.post('/api/nutrition/saved-meals/', b, format='json')  # noqa: E731
        self.assertEqual(post(self.body(items=[])).status_code, 400)
        self.assertEqual(post(self.body(name=' ')).status_code, 400)
        self.assertEqual(post(self.body(items=[{'food_id': str(self.egg.id)}])).status_code, 400)
        self.assertEqual(post(self.body(items=[{'name': 'X'}])).status_code, 400)

    def test_delete(self):
        mid = self.client.post('/api/nutrition/saved-meals/', self.body(), format='json').data['id']
        self.assertEqual(self.client.delete(f'/api/nutrition/saved-meals/{mid}/').status_code, 204)
        self.assertEqual(SavedMeal.objects.count(), 0)


class MealSettingsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def patch(self, meals):
        return self.client.patch('/api/auth/me/', {'profile': {'meals': meals}}, format='json')

    def test_custom_names_order_and_extra_meals(self):
        meals = [
            {'key': 'breakfast', 'name': 'Doručak posle treninga', 'enabled': True},
            {'key': 'snack', 'name': '', 'enabled': False},
            {'key': 'meal5', 'name': 'Obrok pre spavanja', 'enabled': True},
        ]
        res = self.patch(meals)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['profile']['meals'][2], {'key': 'meal5', 'name': 'Obrok pre spavanja', 'enabled': True})

    def test_invalid_settings(self):
        self.assertEqual(self.patch([{'key': 'brunch', 'name': '', 'enabled': True}]).status_code, 400)
        self.assertEqual(self.patch([{'key': 'lunch', 'enabled': True}, {'key': 'lunch', 'enabled': True}]).status_code, 400)
        self.assertEqual(self.patch([{'key': 'lunch', 'enabled': False}]).status_code, 400)
        self.assertEqual(self.patch([{'key': 'lunch', 'name': 'x' * 41, 'enabled': True}]).status_code, 400)
        self.assertEqual(self.patch(None).status_code, 200)
