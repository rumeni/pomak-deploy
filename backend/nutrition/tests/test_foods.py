import json
import uuid
from pathlib import Path

from rest_framework.test import APITestCase

from accounts.models import User
from nutrition.models import Food

DATA = Path(__file__).resolve().parent.parent / 'data' / 'usda_foods.json'


class FoodDatabaseTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def search(self, q, **headers):
        return self.client.get('/api/nutrition/foods/', {'q': q}, **headers).data

    def names(self, q, **headers):
        return [f['name'] for f in self.search(q, **headers)]

    def test_seed_matches_usda_file_exactly(self):
        data = json.loads(DATA.read_text(encoding='utf-8'))['foods']
        self.assertEqual(Food.objects.filter(source='usda').count(), len(data))
        egg = Food.objects.get(slug='egg-raw')
        self.assertEqual((egg.source_ref, float(egg.kcal), float(egg.protein_g)), ('171287', 143.0, 12.56))
        self.assertEqual([(p.name, float(p.grams)) for p in egg.portions.all()], [('1 jaje (veliko)', 50.0), ('1 jaje (srednje)', 44.0)])

    def test_search_without_diacritics_by_alias_and_in_english(self):
        self.assertIn('Piletina, belo meso (sirovo)', self.names('piletina'))
        self.assertIn('Piletina, belo meso (sirovo)', self.names('пилетина'))
        self.assertIn('Piletina, belo meso (sirovo)', self.names('ПИЛЕТИНА'))
        self.assertIn('Šargarepa', self.names('sargarepa'))
        self.assertIn('Leblebije (kuvane)', self.names('slanutak kuvan'))
        self.assertIn('Chicken breast (raw)', self.names('chicken breast', HTTP_ACCEPT_LANGUAGE='en'))

    def test_portion_names_follow_language(self):
        egg = self.search('jaje sirovo', HTTP_ACCEPT_LANGUAGE='en')[0]
        self.assertEqual(egg['portions'][0], {'name': '1 egg (large)', 'grams': '50.00'})

    def test_custom_food_keeps_unknown_macros_as_null(self):
        res = self.client.post('/api/nutrition/foods/', {
            'name': 'Domaći ajvar', 'kcal': '95', 'fat_g': '7.5', 'state': 'prepared',
            'portions': [{'name': '1 kašika', 'grams': '20'}],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['source'], 'custom')
        self.assertTrue(res.data['is_custom'])
        self.assertIsNone(res.data['protein_g'])
        self.assertIsNone(res.data['carbs_g'])
        self.assertEqual(res.data['fat_g'], '7.50')
        self.assertEqual(self.names('ajvar')[0], 'Domaći ajvar')

    def test_custom_food_is_private(self):
        Food.objects.create(owner=self.user, source='custom', name='Moja pita', kcal=250)
        self.client.force_authenticate(User.objects.create_user('c@d.rs', 'jaka-lozinka-123'))
        self.assertNotIn('Moja pita', self.names('pita'))

    def test_validation(self):
        post = lambda body: self.client.post('/api/nutrition/foods/', body, format='json')  # noqa: E731
        self.assertEqual(post({'name': ' ', 'kcal': '100'}).status_code, 400)
        self.assertEqual(post({'name': 'X', 'kcal': '1200'}).status_code, 400)
        self.assertEqual(post({'name': 'X'}).status_code, 400)  # kalorije su obavezne
        res = post({'name': 'X', 'kcal': '500', 'protein_g': '60', 'carbs_g': '30', 'fat_g': '20'})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(post({'name': 'X', 'kcal': '100', 'portions': [{'name': 'kom', 'grams': '0'}]}).status_code, 400)

    def test_shared_food_is_read_only_and_custom_delete_archives(self):
        shared = Food.objects.get(slug='banana')
        self.assertEqual(self.client.patch(f'/api/nutrition/foods/{shared.id}/', {'kcal': '1'}).status_code, 403)
        self.assertEqual(self.client.delete(f'/api/nutrition/foods/{shared.id}/').status_code, 403)

        own = Food.objects.create(owner=self.user, source='custom', name='Proba', kcal=100)
        self.assertEqual(self.client.delete(f'/api/nutrition/foods/{own.id}/').status_code, 204)
        own.refresh_from_db()
        self.assertIsNotNone(own.archived_at)
        self.assertNotIn('Proba', self.names('proba'))


    def test_owner_can_edit_custom_food_and_portions_but_other_user_cannot(self):
        created = self.client.post('/api/nutrition/foods/', {
            'name': 'Moja namirnica', 'kcal': '200', 'state': 'prepared',
            'protein_g': None, 'portions': [{'name': 'komad', 'grams': '30'}],
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        food_id = created.data['id']
        url = f'/api/nutrition/foods/{food_id}/'

        updated = self.client.patch(url, {
            'name': 'Ispravljena namirnica', 'kcal': '175', 'state': 'cooked',
            'protein_g': '12.5', 'portions': [{'name': 'porcija', 'grams': '80'}],
        }, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['name'], 'Ispravljena namirnica')
        self.assertEqual(updated.data['kcal'], '175.0')
        self.assertEqual(updated.data['protein_g'], '12.50')
        self.assertEqual(updated.data['portions'], [{'name': 'porcija', 'grams': '80.00'}])
        self.assertIsNone(updated.data['carbs_g'])

        other = User.objects.create_user('other-food@example.com', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.patch(url, {'name': 'Nije moja'}, format='json').status_code, 404)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(url).data['name'], 'Ispravljena namirnica')


    def test_custom_food_client_uuid_retry_updates_without_duplicate_or_rekey(self):
        food_id = str(uuid.uuid4())
        post = lambda body: self.client.post('/api/nutrition/foods/', body, format='json')  # noqa: E731
        payload = {
            'id': food_id, 'name': 'My oats', 'kcal': '380', 'state': 'raw',
            'protein_g': '13', 'portions': [{'name': 'bowl', 'grams': '80'}],
        }
        first = post(payload)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data['id'], food_id)

        # Retry after a lost response. The database contains only the original.
        same = post(payload)
        self.assertEqual(same.status_code, 200, same.data)
        self.assertEqual(same.data['id'], food_id)
        self.assertEqual(Food.objects.filter(owner=self.user, source='custom').count(), 1)
        self.assertEqual(Food.objects.get(pk=food_id).portions.count(), 1)

        # Retry after the user edits the form: apply updated data to the same row.
        edited = post({
            **payload, 'name': 'My oats (corrected)', 'kcal': '370.0',
            'portions': [{'name': 'serving', 'grams': '70'}],
        })
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data['name'], 'My oats (corrected)')
        self.assertEqual(edited.data['kcal'], '370.0')
        self.assertEqual(edited.data['portions'], [{'name': 'serving', 'grams': '70.00'}])
        self.assertEqual(Food.objects.filter(owner=self.user, source='custom').count(), 1)

        # Even direct PATCH requests carrying an ID cannot move the existing record.
        other_id = str(uuid.uuid4())
        patched = self.client.patch(
            f'/api/nutrition/foods/{food_id}/', {'id': other_id, 'name': 'Changed'}, format='json',
        )
        self.assertEqual(patched.status_code, 200, patched.data)
        self.assertEqual(patched.data['id'], food_id)
        self.assertFalse(Food.objects.filter(pk=other_id).exists())

    def test_custom_food_retry_rejects_others_shared_and_archived_ids(self):
        another = User.objects.create_user('anotherfood@example.com', 'jaka-lozinka-123')
        private = Food.objects.create(owner=another, source='custom', name='Private', kcal='120')
        shared = Food.objects.get(slug='banana')
        for food_id in (str(private.pk), str(shared.pk)):
            result = self.client.post(
                '/api/nutrition/foods/',
                {'id': food_id, 'name': 'Collision', 'kcal': '100', 'state': 'raw'},
                format='json',
            )
            self.assertEqual(result.status_code, 400, result.data)
        private.refresh_from_db()
        self.assertEqual(private.name, 'Private')

        archived_id = str(uuid.uuid4())
        payload = {'id': archived_id, 'name': 'Archived', 'kcal': '100', 'state': 'raw'}
        created = self.client.post('/api/nutrition/foods/', payload, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(self.client.delete(f'/api/nutrition/foods/{archived_id}/').status_code, 204)
        replay = self.client.post('/api/nutrition/foods/', payload, format='json')
        self.assertEqual(replay.status_code, 409, replay.data)
        self.assertEqual(Food.objects.filter(pk=archived_id).count(), 1)

    def test_existing_cyrillic_food_with_legacy_search_key_still_matches(self):
        food = Food.objects.create(owner=self.user, source='custom', name='Моја пилетина', kcal=110)
        # Simulate a record that predates Cyrillic transliteration.
        Food.objects.filter(pk=food.pk).update(search_name='моја пилетина')
        self.assertIn('Моја пилетина', self.names('пилетина'))

    def test_long_unicode_normalization_is_rejected_without_500_or_partial_update(self):
        # U+FDFA expands to a long Arabic phrase under NFKD normalization.
        exotic = '\ufdfa' * 100
        created = self.client.post(
            '/api/nutrition/foods/',
            {'name': exotic, 'kcal': '120', 'state': 'prepared'},
            format='json',
        )
        self.assertEqual(created.status_code, 400, created.data)
        self.assertIn('name', created.data)
        self.assertFalse(Food.objects.filter(owner=self.user, name=exotic).exists())

        own = Food.objects.create(owner=self.user, source='custom', name='Normal food', kcal=100)
        changed = self.client.patch(
            f'/api/nutrition/foods/{own.pk}/', {'name': exotic}, format='json',
        )
        self.assertEqual(changed.status_code, 400, changed.data)
        own.refresh_from_db()
        self.assertEqual(own.name, 'Normal food')
