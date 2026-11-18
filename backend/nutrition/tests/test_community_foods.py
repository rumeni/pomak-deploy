import uuid
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from nutrition import open_food_facts, serializers as food_serializers
from nutrition.views import FoodViewSet
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

    def test_identical_shared_retry_does_not_rewrite_food_or_portions(self):
        food_id = str(uuid.uuid4())
        payload = body(shared=True, id=food_id, portions=[{'name': 'Čaša', 'grams': '200'}])
        self.assertEqual(self.client.post(URL, payload, format='json').status_code, 201)
        food = Food.objects.get(pk=food_id)
        original_time = food.updated_at
        original_portion_ids = list(food.portions.values_list('id', flat=True))
        retry = self.client.post(URL, payload, format='json')
        self.assertEqual(retry.status_code, 200, retry.data)
        food.refresh_from_db()
        self.assertEqual(food.updated_at, original_time)
        self.assertEqual(list(food.portions.values_list('id', flat=True)), original_portion_ids)

    def test_open_reports_have_a_database_uniqueness_guard(self):
        from django.db import IntegrityError, transaction

        food = Food.objects.get(pk=self.create(shared=True).json()['id'])
        FoodReport.objects.create(food=food, reporter=self.author, reason='Original')
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                FoodReport.objects.create(food=food, reporter=self.author, reason='Duplicate')
        self.assertEqual(FoodReport.objects.filter(food=food, resolved_at__isnull=True).count(), 1)
        FoodReport.objects.filter(food=food).update(resolved_at=timezone.now())
        FoodReport.objects.create(food=food, reporter=self.author, reason='New report')
        self.assertEqual(FoodReport.objects.filter(food=food).count(), 2)

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
            'source_ref': 'openfoodfacts:5901234123457', 'source_url': 'https://world.openfoodfacts.org/product/5901234123457',
        })

    def test_nothing_found_or_service_down_is_just_no_suggestion(self):
        for response in (None, {'status': 0}, {'status': 1, 'product': {'nutriments': {}}}):
            with mock.patch.object(open_food_facts, '_fetch', return_value=response):
                data = self.client.get(f'{URL}barcode/5901234123457/').json()
            self.assertEqual(data, {'food': None, 'suggestion': None})
        self.assertEqual(self.client.get(f'{URL}barcode/12ab/').status_code, 404)


class CommunityFoodReviewFollowUps(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('a2@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.author)

    def create(self, **extra):
        return self.client.post(URL, body(**extra), format='json')

    def test_an_archived_product_frees_its_barcode_and_keeps_its_history(self):
        first = self.create(shared=True, barcode='8600939400017').json()
        self.assertEqual(self.client.delete(f'{URL}{first["id"]}/').status_code, 204)
        again = self.create(shared=True, barcode='8600939400017', name='Jogurt (nov unos)')
        self.assertEqual(again.status_code, 201, again.data)
        self.assertEqual(Food.objects.filter(barcode='8600939400017').count(), 2)  # the old row stays archived
        found = self.client.get(f'{URL}barcode/8600939400017/').json()['food']
        self.assertEqual(found['id'], again.json()['id'])

    def test_two_people_adding_the_same_product_at_once_get_a_usable_answer(self):
        other = User.objects.create_user('b2@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        winner = self.create(shared=True, barcode='8600939400024').json()
        self.client.force_authenticate(self.author)
        # The precheck ran before the other insert landed: the database constraint decides.
        with mock.patch.object(food_serializers, 'shared_barcode_clash', side_effect=[None, Food.objects.get(pk=winner['id'])]):
            res = self.create(shared=True, barcode='8600939400024', name='Isti proizvod')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['existing_id'], [winner['id']])

    def test_a_verification_after_loading_wins_over_the_authors_edit(self):
        food = Food.objects.get(pk=self.create(shared=True).json()['id'])
        stale = Food.objects.get(pk=food.pk)  # what the request loaded, before the admin verified
        Food.objects.filter(pk=food.pk).update(verified_at=timezone.now())
        with mock.patch.object(FoodViewSet, 'get_object', return_value=stale):
            res = self.client.patch(f'{URL}{food.id}/', {'kcal': '62'}, format='json')
            delete = self.client.delete(f'{URL}{food.id}/')
        self.assertEqual((res.status_code, delete.status_code), (403, 403))
        food.refresh_from_db()
        self.assertIsNotNone(food.verified_at)
        self.assertEqual((str(food.kcal), food.archived_at), ('61.0', None))

    def test_shared_food_is_revalidated_after_lock_against_latest_macros(self):
        food = Food.objects.get(pk=self.create(shared=True, kcal='100', protein_g='10', carbs_g='15', fat_g='0').json()['id'])
        stale = Food.objects.get(pk=food.pk)
        # Each edit is individually plausible on the original row, but not together:
        # 125 kcal and 12 g carbs must fail against the new expected 88 kcal.
        Food.objects.filter(pk=food.pk).update(kcal='125')
        with mock.patch.object(FoodViewSet, 'get_object', return_value=stale):
            response = self.client.patch(f'{URL}{food.id}/', {'carbs_g': '12'}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        food.refresh_from_db()
        self.assertEqual((str(food.kcal), str(food.carbs_g)), ('125.0', '15.00'))

    def test_open_food_facts_values_keep_their_source_and_stay_private_by_default(self):
        ref = {'source_ref': 'openfoodfacts:3017620422003', 'barcode': '3017620422003'}
        private = self.create(**ref)
        self.assertEqual(private.status_code, 201, private.data)
        self.assertEqual(private.json()['source_ref'], 'openfoodfacts:3017620422003')
        self.assertEqual(self.create(shared=True, name='Deljeno', **{**ref, 'barcode': '3017620422010', 'source_ref': 'openfoodfacts:3017620422010'}).status_code, 400)
        with override_settings(SHARE_OPEN_FOOD_FACTS_DATA=True):
            self.assertEqual(self.create(shared=True, name='Deljeno', **{**ref, 'barcode': '3017620422027', 'source_ref': 'openfoodfacts:3017620422027'}).status_code, 201)
        self.assertEqual(self.create(source_ref='usda:123').status_code, 400)
        # Not shared unless asked for.
        self.assertEqual(self.create(name='Moj obrok').json()['source'], 'custom')

