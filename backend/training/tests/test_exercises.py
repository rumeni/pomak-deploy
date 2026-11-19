import uuid

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
        self.assertGreaterEqual(Exercise.objects.filter(owner__isnull=True).count(), 150)

    def test_library_source_is_complete(self):
        # Every shared exercise: a unique slug, an English name and instructions in both
        # languages ending with a tip; and all of them reach the database.
        from training.data.instructions import INSTRUCTIONS
        from training.exercise_library import EXERCISES, NAMES_EN

        slugs = [row[0] for row in EXERCISES]
        self.assertEqual(len(slugs), len(set(slugs)))
        for slug in slugs:
            with self.subTest(slug=slug):
                self.assertTrue(NAMES_EN.get(slug))
                text = INSTRUCTIONS[slug]
                self.assertTrue(text['sr'][-1].startswith('Savet:'))
                self.assertTrue(text['en'][-1].startswith('Tip:'))
        self.assertEqual(set(NAMES_EN), set(slugs))
        self.assertEqual(
            set(Exercise.objects.filter(owner__isnull=True).values_list('slug', flat=True)), set(slugs),
        )

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


    def test_custom_exercise_client_uuid_retry_updates_without_duplicate_or_rekey(self):
        exercise_id = str(uuid.uuid4())
        payload = {
            'id': exercise_id, 'name': 'Cable pull', 'equipment': 'cable',
            'measurement': 'weight_reps', 'muscle': 'back', 'load_mode': 'total',
        }
        url = '/api/training/exercises/'
        first = self.client.post(url, payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data['id'], exercise_id)

        same = self.client.post(url, payload, format='json')
        self.assertEqual(same.status_code, 200, same.data)
        self.assertEqual(Exercise.objects.filter(owner=self.user).count(), 1)

        updated = self.client.post(url, {**payload, 'name': 'Cable pull corrected', 'muscle': 'shoulders'}, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['muscle'], 'shoulders')
        self.assertEqual(updated.data['name'], 'Cable pull corrected')
        self.assertEqual(Exercise.objects.filter(owner=self.user).count(), 1)

        other_id = str(uuid.uuid4())
        patched = self.client.patch(
            f'{url}{exercise_id}/', {'id': other_id, 'name': 'Final name'}, format='json',
        )
        self.assertEqual(patched.status_code, 200, patched.data)
        self.assertEqual(patched.data['id'], exercise_id)
        self.assertFalse(Exercise.objects.filter(pk=other_id).exists())

    def test_custom_exercise_retry_rejects_other_shared_archived_ids(self):
        another = User.objects.create_user('anotherexercise@example.com', 'jaka-lozinka-123')
        private = Exercise.objects.create(
            owner=another, name='Private', equipment='other', measurement='weight_reps', muscle='back',
        )
        shared = Exercise.objects.get(slug='deadlift')
        url = '/api/training/exercises/'
        for exercise_id in (str(private.pk), str(shared.pk)):
            result = self.client.post(
                url,
                {'id': exercise_id, 'name': 'Collision', 'equipment': 'other',
                 'measurement': 'weight_reps', 'muscle': 'back'},
                format='json',
            )
            self.assertEqual(result.status_code, 400, result.data)
        private.refresh_from_db()
        self.assertEqual(private.name, 'Private')

        archived_id = str(uuid.uuid4())
        payload = {
            'id': archived_id, 'name': 'Archived', 'equipment': 'other',
            'measurement': 'weight_reps', 'muscle': 'back',
        }
        created = self.client.post(url, payload, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(self.client.delete(f'{url}{archived_id}/').status_code, 204)
        replay = self.client.post(url, payload, format='json')
        self.assertEqual(replay.status_code, 409, replay.data)
        self.assertEqual(Exercise.objects.filter(pk=archived_id).count(), 1)

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
