from rest_framework.test import APITestCase

from accounts.models import User


class AuthFlowTests(APITestCase):
    def test_register_login_and_me(self):
        res = self.client.post('/api/auth/register/', {
            'email': 'Marko@Primer.rs', 'password': 'jaka-lozinka-123', 'display_name': 'Marko',
        })
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIn('access', res.data)

        user = User.objects.get()
        self.assertEqual(user.email, 'marko@primer.rs')
        self.assertEqual(user.profile.display_name, 'Marko')

        res = self.client.post('/api/auth/login/', {'email': 'marko@primer.rs', 'password': 'jaka-lozinka-123'})
        self.assertEqual(res.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

        res = self.client.patch('/api/auth/me/', {'profile': {'tracks_nutrition': False}}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(res.data['profile']['tracks_nutrition'])
        self.assertEqual(res.data['profile']['display_name'], 'Marko')

    def test_register_as_coach(self):
        res = self.client.post('/api/auth/register/', {
            'email': 'trener@primer.rs', 'password': 'jaka-lozinka-123', 'account_type': 'coach',
        })
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(User.objects.get().profile.is_coach)

    def test_register_remembers_app_language(self):
        self.client.post('/api/auth/register/', {'email': 'e@primer.rs', 'password': 'jaka-lozinka-123', 'language': 'en'})
        self.assertEqual(User.objects.get().profile.language, 'en')

    def test_client_cannot_make_self_coach_via_profile(self):
        user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(user)
        self.client.patch('/api/auth/me/', {'profile': {'is_coach': True}}, format='json')
        user.profile.refresh_from_db()
        self.assertFalse(user.profile.is_coach)

    def test_body_data_validation(self):
        user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(user)
        res = self.client.patch('/api/auth/me/', {'profile': {'height_cm': '1800'}}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.patch('/api/auth/me/', {'profile': {'birth_date': '2999-01-01'}}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.patch('/api/auth/me/', {
            'profile': {'sex': 'male', 'birth_date': '1995-05-20', 'height_cm': '181.5'},
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['profile']['height_cm'], '181.5')

    def test_duplicate_email_rejected(self):
        User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        res = self.client.post('/api/auth/register/', {'email': 'A@B.rs', 'password': 'jaka-lozinka-123'})
        self.assertEqual(res.status_code, 400)

    def test_wrong_password_message_is_serbian(self):
        User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        res = self.client.post('/api/auth/login/', {'email': 'A@b.rs', 'password': 'pogresna'})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data['detail'], 'Pogrešan email ili lozinka.')

    def test_login_email_is_case_insensitive(self):
        User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        res = self.client.post('/api/auth/login/', {'email': 'A@B.rs', 'password': 'jaka-lozinka-123'})
        self.assertEqual(res.status_code, 200)

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
