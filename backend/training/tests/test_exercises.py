from rest_framework.test import APITestCase

from accounts.models import User
from training.models import Exercise


class ExerciseLibraryTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def names(self, res):
        return [e['name'] for e in res.data]

    def search(self, **params):
        return self.names(self.client.get('/api/training/exercises/', params))

    def test_library_is_seeded(self):
        self.assertGreaterEqual(Exercise.objects.filter(owner__isnull=True).count(), 50)

    def test_every_library_exercise_has_instructions_in_both_languages(self):
        library = Exercise.objects.filter(owner__isnull=True)
        self.assertFalse(library.filter(instructions='').exists())
        self.assertFalse(library.filter(instructions_en='').exists())

    def test_instructions_follow_app_language(self):
        bench = Exercise.objects.get(slug='bench-press')
        sr = self.client.get(f'/api/training/exercises/{bench.id}/', HTTP_ACCEPT_LANGUAGE='sr-latn').data
        en = self.client.get(f'/api/training/exercises/{bench.id}/', HTTP_ACCEPT_LANGUAGE='en').data
        self.assertTrue(sr['instructions'].startswith('Lezi na klupu'))
        self.assertTrue(en['instructions'].startswith('Lie on the bench'))
        self.assertEqual(sr['slug'], 'bench-press')

    def test_search_without_diacritics_and_by_english_alias(self):
        self.assertIn('Čučanj sa šipkom', self.search(q='cucanj'))
        self.assertIn('Potisak sa ravne klupe (šipka)', self.search(q='bench'))
        self.assertIn('Potisak sa ravne klupe (šipka)', self.search(q='benč'))

    def test_letters_with_diacritics_sort_next_to_base_letter(self):
        names = self.search(muscle='biceps')
        self.assertLess(names.index('Čekić pregib'), names.index('Pregib sa bučicama'))

    def test_multiple_words_must_all_match(self):
        names = self.search(q='potisak bucice')
        self.assertIn('Potisak sa ravne klupe (bučice)', names)
        self.assertNotIn('Potisak sa ravne klupe (šipka)', names)

    def test_custom_exercise_visible_only_to_owner_and_listed_first(self):
        res = self.client.post('/api/training/exercises/', {
            'name': 'Moja vežba za leđa', 'equipment': 'machine', 'measurement': 'weight_reps', 'muscle': 'back',
        })
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['is_custom'])
        self.assertEqual(self.search(muscle='back')[0], 'Moja vežba za leđa')

        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        self.assertNotIn('Moja vežba za leđa', self.search(q='moja'))

    def test_shared_exercise_cannot_be_edited_or_deleted(self):
        shared = Exercise.objects.get(slug='deadlift')
        self.assertEqual(self.client.patch(f'/api/training/exercises/{shared.id}/', {'name': 'x'}).status_code, 403)
        self.assertEqual(self.client.delete(f'/api/training/exercises/{shared.id}/').status_code, 403)

    def test_deleting_custom_exercise_archives_it(self):
        ex = Exercise.objects.create(owner=self.user, name='Test', equipment='other', measurement='weight_reps', muscle='core')
        self.assertEqual(self.client.delete(f'/api/training/exercises/{ex.id}/').status_code, 204)
        ex.refresh_from_db()
        self.assertIsNotNone(ex.archived_at)
        self.assertNotIn('Test', self.search(q='test'))

    def test_exotic_unicode_search_key_overflow_returns_400(self):
        exotic = '\ufdfa' * 100
        body = {
            'name': exotic, 'equipment': 'other',
            'measurement': 'weight_reps', 'muscle': 'core',
        }
        response = self.client.post('/api/training/exercises/', body, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('name', response.data)
        self.assertFalse(Exercise.objects.filter(owner=self.user, name=exotic).exists())

        own = Exercise.objects.create(
            owner=self.user, name='Normal exercise', equipment='other',
            measurement='weight_reps', muscle='core',
        )
        updated = self.client.patch(
            f'/api/training/exercises/{own.pk}/', {'name': exotic}, format='json',
        )
        self.assertEqual(updated.status_code, 400, updated.data)
        own.refresh_from_db()
        self.assertEqual(own.name, 'Normal exercise')
