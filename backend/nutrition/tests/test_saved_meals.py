import threading
import time
import uuid
from unittest import mock

from django.db import connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from nutrition.models import Food, SavedMeal, SavedMealItem
from nutrition.views import FoodViewSet


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


class SharedFoodSavedMealRaceTests(TransactionTestCase):
    """Actual concurrent API requests must serialize a food edit/archive and new meal reference."""

    def setUp(self):
        self.author = User.objects.create_user('saved-author@example.test', 'test-password-123')
        self.other = User.objects.create_user('saved-other@example.test', 'test-password-123')
        self.food = Food.objects.create(
            source=Food.Source.COMMUNITY, created_by=self.author, name='Deljeni jogurt',
            state=Food.State.PREPARED, kcal='61',
        )

    def api(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def create_body(self):
        return {'name': 'Sačuvani doručak', 'items': [{'food_id': str(self.food.pk), 'grams': '100'}]}

    def concurrent(self, first, second, *, first_at_lock):
        """Pause the first request after locking the food; the other must wait."""
        locked = threading.Event()
        release = threading.Event()
        started_second = threading.Event()
        result = {}
        errors = []

        def run(name, fn):
            connections.close_all()
            try:
                result[name] = fn()
            except Exception as e:
                errors.append((name, e))
            finally:
                connections.close_all()

        def first_fn():
            return first(locked, release)

        def second_fn():
            started_second.set()
            return second()

        a = threading.Thread(target=run, args=('first', first_fn))
        b = threading.Thread(target=run, args=('second', second_fn))
        try:
            a.start()
            self.assertTrue(locked.wait(8), first_at_lock)
            b.start()
            self.assertTrue(started_second.wait(8))
            time.sleep(0.15)
            self.assertTrue(b.is_alive(), 'second request did not wait on the locked food')
        finally:
            release.set()
            a.join(12)
            if b.ident is not None:
                b.join(12)
        self.assertFalse(a.is_alive(), 'first request was blocked')
        self.assertFalse(b.is_alive(), 'second request was blocked')
        self.assertFalse(errors, errors)
        return result

    def test_saved_meal_wins_before_author_edit_then_edit_conflicts(self):
        create_bulk = SavedMealItem.objects.bulk_create

        def first(locked, release):
            def paused_bulk(*args, **kwargs):
                locked.set()  # SavedMealSerializer has already locked the Food row
                if not release.wait(8):
                    raise AssertionError('Timed out while holding food lock')
                return create_bulk(*args, **kwargs)

            with mock.patch.object(SavedMealItem.objects, 'bulk_create', side_effect=paused_bulk):
                return self.api(self.other).post('/api/nutrition/saved-meals/', self.create_body(), format='json')

        result = self.concurrent(
            first, lambda: self.api(self.author).patch(
                f'/api/nutrition/foods/{self.food.pk}/', {'kcal': '62'}, format='json'),
            first_at_lock='saved meal never acquired the food lock',
        )
        self.assertEqual(result['first'].status_code, 201, result['first'].data)
        self.assertEqual(result['second'].status_code, 409, result['second'].data)
        self.food.refresh_from_db()
        self.assertEqual(self.food.kcal, 61)
        self.assertTrue(SavedMealItem.objects.filter(food=self.food, saved_meal__owner=self.other).exists())

    def test_archive_wins_first_then_stale_saved_meal_is_rejected(self):
        require_own = FoodViewSet._require_own

        def first(locked, release):
            def paused_authorization(view, item):
                require_own(view, item)
                locked.set()  # perform_destroy already selected the food FOR UPDATE
                if not release.wait(8):
                    raise AssertionError('Timed out while holding food lock')

            with mock.patch.object(FoodViewSet, '_require_own', paused_authorization):
                return self.api(self.author).delete(f'/api/nutrition/foods/{self.food.pk}/')

        result = self.concurrent(
            first,
            lambda: self.api(self.other).post('/api/nutrition/saved-meals/', self.create_body(), format='json'),
            first_at_lock='author archive never acquired the food lock',
        )
        self.assertEqual(result['first'].status_code, 204)
        self.assertEqual(result['second'].status_code, 400, result['second'].data)
        self.assertFalse(SavedMeal.objects.filter(owner=self.other).exists())
        self.food.refresh_from_db()
        self.assertIsNotNone(self.food.archived_at)
