from rest_framework.test import APITestCase

from accounts.models import User
from training.models import Exercise


class LanguageTests(APITestCase):
    """Server odgovara na jeziku iz zaglavlja Accept-Language; podrazumevano srpski."""

    def test_default_is_serbian_including_drf_messages(self):
        res = self.client.post('/api/auth/login/', {'email': 'a@b.rs', 'password': 'x'})
        self.assertEqual(res.data['detail'], 'Pogrešan email ili lozinka.')
        res = self.client.post('/api/auth/register/', {'email': 'a@b.rs'})
        self.assertEqual(res.data['password'], ['Ovo polje je obavezno.'])

    def test_new_validation_messages_are_present_in_compiled_serbian_catalog(self):
        # Verifies django.mo, not just translations_sr.py / the source django.po.
        from django.utils import translation

        with translation.override('sr-latn'):
            translated = translation.gettext(
                'This item was already saved. Refresh to see the saved version.')
            self.assertIn('već sačuvana', translated)
            translated = translation.gettext(
                'This food cannot be changed because a recipe using it would become invalid.')
            self.assertIn('recept', translated)
            translated = translation.gettext(
                'This shared food is used in another user\'s recipe or saved meal. Report an error instead.')
            self.assertIn('tuđem receptu', translated)
            self.assertIn('sačuvanom obroku', translated)

    def test_english(self):
        res = self.client.post('/api/auth/login/', {'email': 'a@b.rs', 'password': 'x'}, HTTP_ACCEPT_LANGUAGE='en')
        self.assertEqual(res.data['detail'], 'Wrong email or password.')
        res = self.client.post('/api/auth/register/', {'email': 'a@b.rs'}, HTTP_ACCEPT_LANGUAGE='en')
        self.assertEqual(res.data['password'], ['This field is required.'])

    def test_django_password_validation_is_translated(self):
        res = self.client.post('/api/auth/register/', {'email': 'a@b.rs', 'password': '123'}, HTTP_ACCEPT_LANGUAGE='sr-Latn')
        self.assertIn('lozinka', str(res.data).lower())

    def test_exercise_names_follow_language_and_search_works_in_both(self):
        self.client.force_authenticate(User.objects.create_user('a@b.rs', 'jaka-lozinka-123'))
        squat = Exercise.objects.get(slug='back-squat')

        sr = self.client.get(f'/api/training/exercises/{squat.id}/')
        en = self.client.get(f'/api/training/exercises/{squat.id}/', HTTP_ACCEPT_LANGUAGE='en')
        self.assertEqual(sr.data['name'], 'Čučanj sa šipkom')
        self.assertEqual(en.data['name'], 'Squat (Barbell)')

        found = self.client.get('/api/training/exercises/', {'q': 'squat barbell'}, HTTP_ACCEPT_LANGUAGE='en')
        self.assertIn('Squat (Barbell)', [e['name'] for e in found.data])

    def test_custom_exercise_keeps_its_name_in_english(self):
        user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(user)
        own = Exercise.objects.create(owner=user, name='Moja vežba', equipment='other', measurement='weight_reps', muscle='core')
        res = self.client.get(f'/api/training/exercises/{own.id}/', HTTP_ACCEPT_LANGUAGE='en')
        self.assertEqual(res.data['name'], 'Moja vežba')

    def test_profile_language_setting(self):
        self.client.force_authenticate(User.objects.create_user('a@b.rs', 'jaka-lozinka-123'))
        res = self.client.patch('/api/auth/me/', {'profile': {'language': 'en'}}, format='json')
        self.assertEqual(res.data['profile']['language'], 'en')
        res = self.client.patch('/api/auth/me/', {'profile': {'language': 'de'}}, format='json')
        self.assertEqual(res.status_code, 400)
