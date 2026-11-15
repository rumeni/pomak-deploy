from unittest.mock import patch

from django.utils import timezone
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


class TokenRevocationTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('revoke@primer.rs', 'jaka-lozinka-123')

    def test_rotated_refresh_and_logout_revoke_tokens(self):
        login = self.client.post('/api/auth/login/', {'email': self.user.email, 'password': 'jaka-lozinka-123'})
        self.assertEqual(login.status_code, 200, login.data)
        initial = login.data['refresh']
        rotate = self.client.post('/api/auth/refresh/', {'refresh': initial}, format='json')
        self.assertEqual(rotate.status_code, 200, rotate.data)
        self.assertEqual(self.client.post('/api/auth/refresh/', {'refresh': initial}, format='json').status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {rotate.data['access']}")
        logout = self.client.post('/api/auth/logout/', {'refresh': rotate.data['refresh']}, format='json')
        self.assertEqual(logout.status_code, 204, logout.data)
        self.assertEqual(self.client.post('/api/auth/refresh/', {'refresh': rotate.data['refresh']}, format='json').status_code, 401)

    def test_logout_wont_revoke_other_user_token(self):
        other = User.objects.create_user('other@primer.rs', 'jaka-lozinka-123')
        from rest_framework_simplejwt.tokens import RefreshToken
        stolen = RefreshToken.for_user(other)
        mine = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {mine.access_token}')
        res = self.client.post('/api/auth/logout/', {'refresh': str(stolen)}, format='json')
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(self.client.post('/api/auth/refresh/', {'refresh': str(stolen)}, format='json').status_code, 200)


class DatabaseAuthThrottleTests(APITestCase):
    def setUp(self):
        # Keep the PostgreSQL bucket window stable across slow CI runs.
        self.clock = patch('accounts.throttles.timezone.now',
                           return_value=timezone.now().replace(second=10, microsecond=0))
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def test_account_limit_shared_across_ip_addresses(self):
        from accounts.models import AuthThrottleBucket
        from accounts.throttles import DatabaseAuthThrottle
        from rest_framework.test import APIRequestFactory
        from rest_framework.request import Request
        from rest_framework.parsers import JSONParser

        factory = APIRequestFactory()
        for idx in range(10):
            req = Request(factory.post('/api/auth/login/', {'email': 'TARGET@example.com'}, format='json', REMOTE_ADDR=f'192.0.2.{idx + 1}'), parsers=[JSONParser()])
            self.assertTrue(DatabaseAuthThrottle().allow_request(req, None))
        req = Request(factory.post('/api/auth/login/', {'email': 'target@example.com'}, format='json', REMOTE_ADDR='192.0.2.50'), parsers=[JSONParser()])
        self.assertFalse(DatabaseAuthThrottle().allow_request(req, None))
        self.assertEqual(AuthThrottleBucket.objects.filter(attempts__gte=10).count(), 1)


    def test_one_ip_cannot_create_more_than_sixty_unique_account_buckets_per_minute(self):
        from accounts.models import AuthThrottleBucket
        from accounts.throttles import AUTH_IP_LIMIT_PER_MINUTE, DatabaseAuthThrottle
        from rest_framework.test import APIRequestFactory
        from rest_framework.request import Request
        from rest_framework.parsers import JSONParser

        self.assertEqual(AUTH_IP_LIMIT_PER_MINUTE, 60)
        factory = APIRequestFactory()
        for index in range(60):
            req = Request(factory.post(
                '/api/auth/login/', {'email': f'unique-{index}@example.com'},
                format='json', REMOTE_ADDR='203.0.113.17',
            ), parsers=[JSONParser()])
            self.assertTrue(DatabaseAuthThrottle().allow_request(req, None))
        blocked = Request(factory.post(
            '/api/auth/login/', {'email': 'unique-60@example.com'},
            format='json', REMOTE_ADDR='203.0.113.17',
        ), parsers=[JSONParser()])
        self.assertFalse(DatabaseAuthThrottle().allow_request(blocked, None))
        # One shared IP bucket and exactly 60 account buckets, not 61.
        self.assertEqual(AuthThrottleBucket.objects.count(), 61)


class AccountDeletionThrottleTests(APITestCase):
    def setUp(self):
        # Keep the PostgreSQL bucket window stable across slow CI runs.
        self.clock = patch('accounts.throttles.timezone.now',
                           return_value=timezone.now().replace(second=10, microsecond=0))
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def test_repeated_wrong_passwords_are_limited_per_account_across_ips(self):
        user = User.objects.create_user('delete-limit@primer.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(user)
        for i in range(5):
            response = self.client.post('/api/auth/me/delete/', {'password': 'not-the-password'},
                                        format='json', REMOTE_ADDR=f'192.0.2.{i + 10}')
            self.assertEqual(response.status_code, 400, response.data)
        blocked = self.client.post('/api/auth/me/delete/', {'password': 'not-the-password'},
                                   format='json', REMOTE_ADDR='203.0.113.250')
        self.assertEqual(blocked.status_code, 429, blocked.data)
        self.assertTrue(User.objects.filter(pk=user.pk).exists())


class ForwardedIpSettingsTests(APITestCase):
    def test_untrusted_forwarded_for_is_ignored_in_direct_development(self):
        from django.conf import settings
        from django.test import override_settings
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory
        from rest_framework.throttling import BaseThrottle

        request = Request(APIRequestFactory().post('/api/auth/login/', {}, format='json',
                                                  REMOTE_ADDR='192.0.2.42',
                                                  HTTP_X_FORWARDED_FOR='1.1.1.1, 2.2.2.2'))
        with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, 'NUM_PROXIES': 0}):
            self.assertEqual(BaseThrottle().get_ident(request), '192.0.2.42')

    def test_vercel_proxy_count_selects_the_last_forwarded_address(self):
        from django.conf import settings
        from django.test import override_settings
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory
        from rest_framework.throttling import BaseThrottle

        request = Request(APIRequestFactory().post('/api/auth/login/', {}, format='json',
                                                  REMOTE_ADDR='10.0.0.12',
                                                  HTTP_X_FORWARDED_FOR='198.51.100.8, 203.0.113.9'))
        with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, 'NUM_PROXIES': 1}):
            self.assertEqual(BaseThrottle().get_ident(request), '203.0.113.9')
