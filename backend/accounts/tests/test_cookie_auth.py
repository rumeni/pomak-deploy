"""Cookie transport is opt-in; old Android JSON token behavior is unchanged."""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User

WEB = {'HTTP_X_POMAK_CLIENT': 'web'}


class AuthCookieTransportTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('cookie@primer.rs', 'jaka-lozinka-123')

    def login(self, **headers):
        return self.client.post('/api/auth/login/', {
            'email': self.user.email, 'password': 'jaka-lozinka-123',
        }, format='json', **headers)

    def assert_cookie(self, response):
        self.assertNotIn('refresh', response.data)
        cookie = response.cookies['pomak.refresh']
        self.assertTrue(cookie['httponly'])
        self.assertTrue(cookie['secure'])
        self.assertEqual(cookie['samesite'], 'Strict')
        self.assertEqual(cookie['path'], '/api/auth/')
        self.assertEqual(cookie['max-age'], 30 * 24 * 60 * 60)
        self.assertNotIn('domain', cookie.keys())

    def test_web_login_refresh_from_cookie_only_and_rotate(self):
        login = self.login(**WEB)
        self.assertEqual(login.status_code, 200, login.data)
        self.assert_cookie(login)
        first = login.cookies['pomak.refresh'].value
        self.client.cookies['pomak.refresh'] = first

        refreshed = self.client.post('/api/auth/refresh/', {}, format='json', **WEB)
        self.assertEqual(refreshed.status_code, 200, refreshed.data)
        self.assert_cookie(refreshed)
        self.assertNotEqual(first, refreshed.cookies['pomak.refresh'].value)
        self.assertEqual(self.client.post(
            '/api/auth/refresh/', {'refresh': first}, format='json',
        ).status_code, 401)

    def test_web_prefers_body_token_for_one_time_migration(self):
        legacy = self.login()
        self.assertIn('refresh', legacy.data)
        new = self.client.post('/api/auth/refresh/', {
            'refresh': legacy.data['refresh'],
        }, format='json', **WEB)
        self.assertEqual(new.status_code, 200, new.data)
        self.assert_cookie(new)

    def test_legacy_without_header_is_identical(self):
        login = self.login()
        self.assertEqual(login.status_code, 200)
        self.assertIn('refresh', login.data)
        self.assertNotIn('pomak.refresh', login.cookies)
        refreshed = self.client.post('/api/auth/refresh/', {
            'refresh': login.data['refresh'],
        }, format='json')
        self.assertEqual(refreshed.status_code, 200)
        self.assertIn('refresh', refreshed.data)
        self.assertNotIn('pomak.refresh', refreshed.cookies)

    def test_web_logout_blacklists_and_clears_cookie(self):
        login = self.login(**WEB)
        self.client.cookies['pomak.refresh'] = login.cookies['pomak.refresh'].value
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        logout = self.client.post('/api/auth/logout/', {}, format='json', **WEB)
        self.assertEqual(logout.status_code, 204)
        cookie = logout.cookies['pomak.refresh']
        self.assertEqual(cookie['max-age'], 0)
        self.assertEqual(cookie['path'], '/api/auth/')
        self.assertEqual(cookie['samesite'], 'Strict')
        self.assertEqual(self.client.post('/api/auth/refresh/', {
            'refresh': login.cookies['pomak.refresh'].value,
        }, format='json').status_code, 401)

    def test_legacy_logout_has_no_cookie_side_effect(self):
        login = self.login()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        logout = self.client.post('/api/auth/logout/', {
            'refresh': login.data['refresh'],
        }, format='json')
        self.assertEqual(logout.status_code, 204)
        self.assertNotIn('pomak.refresh', logout.cookies)
