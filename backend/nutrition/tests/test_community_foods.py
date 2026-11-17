import uuid
from unittest import mock

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from nutrition import open_food_facts
from nutrition.models import Food, FoodReport

URL = '/api/nutrition/foods/'


def body(**extra):
    return {
        'name': 'Jogurt 2,8% (Moravka)', 'state': 'prepared', 'kcal': '61',
        'protein_g': '3.2', 'carbs_g': '4.6', 'fat_g': '2.8', 'portions': [], **extra,
    }


class CommunityFoodTests(APITestCase):
    """Foods added for everyone: visible to all, editable by the author until verified."""

    def setUp(self):
        self.author = User.objects.create_user('autor@b.rs', 'jaka-lozinka-123')
        self.other = User.objects.create_user('drugi@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.author)

    def create(self, **extra):
        return self.client.post(URL, body(**extra), format='json')

    def test_shared_food_is_visible_to_everyone_and_editable_only_by_its_author(self):
        res = self.create(shared=True, barcode='8600939400017')
        self.assertEqual(res.status_code, 201, res.data)
        data = res.json()
        self.assertEqual((data['source'], data['verified'], data['can_edit'], data['is_custom']), ('community', False, True, False))
        food = Food.objects.get(source='community')
        self.assertEqual((food.owner_id, food.created_by_id), (None, self.author.pk))

        self.client.force_authenticate(self.other)
        found = self.client.get(URL, {'q': 'moravka'}).json()
        self.assertEqual([(f['name'], f['can_edit']) for f in found], [('Jogurt 2,8% (Moravka)', False)])
        self.assertNotIn('created_by', found[0])  # the author is never shown
        self.assertEqual(self.client.patch(f'{URL}{food.id}/', {'kcal': '70'}, format='json').status_code, 403)

        self.client.force_authenticate(self.author)
        self.assertEqual(self.client.patch(f'{URL}{food.id}/', {'kcal': '62'}, format='json').status_code, 200)
        # Once an admin verified it, it is no longer the author's to change.
        Food.objects.filter(pk=food.pk).update(verified_at=timezone.now())
        self.assertEqual(self.client.patch(f'{URL}{food.id}/', {'kcal': '63'}, format='json').status_code, 403)
        self.assertTrue(self.client.get(f'{URL}{food.id}/').json()['verified'])

    def test_shared_values_must_be_consistent_but_private_ones_are_the_users_business(self):
        res = self.create(shared=True, kcal='250')  # macros give about 57 kcal
        self.assertEqual(res.status_code, 400)
        self.assertIn('kcal', res.json())
        self.assertEqual(self.create(kcal='250').status_code, 201)
        # Unknown macros: nothing to compare with.
        self.assertEqual(self.create(shared=True, name='Čokoladica', kcal='520', protein_g=None).status_code, 201)

    def test_one_shared_entry_per_barcode_found_by_scanning_or_typing(self):
        first = self.create(shared=True, barcode='8600939400017').json()
        clash = self.create(shared=True, barcode='8600939400017', name='Drugi naziv')
        self.assertEqual(clash.status_code, 400)
        self.assertEqual(clash.json()['existing_id'], [first['id']])
        # A private copy with the same barcode is allowed (it is only the user's).
        self.assertEqual(self.create(barcode='8600939400017').status_code, 201)
        self.assertEqual(self.create(shared=True, barcode='12ab').status_code, 400)
        self.assertEqual(len(self.client.get(URL, {'q': '8600939400017'}).json()), 2)

    def test_repeated_create_of_a_shared_food_is_a_retry(self):
        food_id = str(uuid.uuid4())
        self.assertEqual(self.create(shared=True, id=food_id).status_code, 201)
        self.assertEqual(self.create(shared=True, id=food_id).status_code, 200)
        self.assertEqual(Food.objects.filter(source='community').count(), 1)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.create(shared=True, id=food_id).status_code, 400)

    def test_report_wrong_values_on_shared_foods_only(self):
        shared = self.create(shared=True).json()
        private = self.create(name='Moj jogurt').json()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f'{URL}{shared["id"]}/report/', {'reason': 'Proteini su 4,1 g'}, format='json').status_code, 204)
        # A second report by the same user updates the open one.
        self.client.post(f'{URL}{shared["id"]}/report/', {'reason': 'Proteini su 4,2 g'}, format='json')
        self.assertEqual(list(FoodReport.objects.values_list('reason', flat=True)), ['Proteini su 4,2 g'])
        self.assertEqual(self.client.post(f'{URL}{shared["id"]}/report/', {'reason': ' '}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'{URL}{private["id"]}/report/', {'reason': 'x'}, format='json').status_code, 404)

    def test_deleting_the_account_keeps_the_shared_food_without_the_author(self):
        self.create(shared=True)
        self.client.post('/api/auth/me/delete/', {'password': 'jaka-lozinka-123'}, format='json')
        food = Food.objects.get(source='community')
        self.assertIsNone(food.created_by_id)


class BarcodeLookupTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('sken@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def test_known_product_comes_from_our_database_without_calling_out(self):
        self.client.post(URL, body(shared=True, barcode='8600939400017'), format='json')
        with mock.patch.object(open_food_facts, '_fetch') as fetch:
            data = self.client.get(f'{URL}barcode/8600939400017/').json()
        fetch.assert_not_called()
        self.assertEqual((data['food']['barcode'], data['suggestion']), ('8600939400017', None))

    def test_unknown_product_gets_an_open_food_facts_suggestion(self):
        response = {'status': 1, 'product': {'product_name': 'Jogurt', 'brands': 'Moravka, Imlek', 'nutriments': {
            'energy-kj_100g': 255, 'proteins_100g': 3.2, 'carbohydrates_100g': 4.6, 'fat_100g': 2.8, 'fiber_100g': 'x',
        }}}
        with mock.patch.object(open_food_facts, '_fetch', return_value=response) as fetch:
            data = self.client.get(f'{URL}barcode/5901234123457/').json()
        fetch.assert_called_once_with('5901234123457')
        self.assertIsNone(data['food'])
        self.assertEqual(data['suggestion'], {
            'name': 'Jogurt (Moravka)', 'barcode': '5901234123457', 'kcal': '61',
            'protein_g': '3.2', 'carbs_g': '4.6', 'fat_g': '2.8', 'fiber_g': None, 'source': 'open_food_facts',
        })

    def test_nothing_found_or_service_down_is_just_no_suggestion(self):
        for response in (None, {'status': 0}, {'status': 1, 'product': {'nutriments': {}}}):
            with mock.patch.object(open_food_facts, '_fetch', return_value=response):
                data = self.client.get(f'{URL}barcode/5901234123457/').json()
            self.assertEqual(data, {'food': None, 'suggestion': None})
        self.assertEqual(self.client.get(f'{URL}barcode/12ab/').status_code, 404)
