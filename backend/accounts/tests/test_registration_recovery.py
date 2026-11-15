from rest_framework.test import APITestCase
from accounts.models import User


class WebRegistrationRecoveryTests(APITestCase):
    def setUp(self):
        User.objects.create_user('previous@example.com', 'strong-password-123')
        response = self.client.post('/api/auth/login/', {
            'email': 'previous@example.com', 'password': 'strong-password-123',
        }, format='json', HTTP_X_POMAK_CLIENT='web')
        self.assertEqual(response.status_code, 200)
        self.old_cookie = response.cookies['pomak.refresh'].value

    def test_registration_replaces_prior_cookie(self):
        response = self.client.post('/api/auth/register/', {
            'email': 'new-account@example.com', 'password': 'strong-password-123',
        }, format='json', HTTP_X_POMAK_CLIENT='web')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn('refresh', response.data)
        new_cookie = response.cookies['pomak.refresh'].value

        self.client.cookies['pomak.refresh'] = self.old_cookie
        old_result = self.client.post('/api/auth/refresh/', {},
                                      format='json', HTTP_X_POMAK_CLIENT='web')
        self.assertEqual(old_result.status_code, 401)

        self.client.cookies['pomak.refresh'] = new_cookie
        new_result = self.client.post('/api/auth/refresh/', {},
                                      format='json', HTTP_X_POMAK_CLIENT='web')
        self.assertEqual(new_result.status_code, 200)

    def test_rejected_registration_does_not_revoke_prior_cookie(self):
        rejected = self.client.post('/api/auth/register/', {
            'email': 'previous@example.com', 'password': 'strong-password-123',
        }, format='json', HTTP_X_POMAK_CLIENT='web')
        self.assertEqual(rejected.status_code, 400)

        self.client.cookies['pomak.refresh'] = self.old_cookie
        response = self.client.post('/api/auth/refresh/', {},
                                    format='json', HTTP_X_POMAK_CLIENT='web')
        self.assertEqual(response.status_code, 200)

    def test_invalid_prior_cookie_is_ignored(self):
        self.client.cookies['pomak.refresh'] = 'invalid-old-value'
        response = self.client.post('/api/auth/register/', {
            'email': 'another@example.com', 'password': 'strong-password-123',
        }, format='json', HTTP_X_POMAK_CLIENT='web')
        self.assertEqual(response.status_code, 201, response.data)

    def test_revocation_failure_rolls_back_new_account(self):
        from unittest.mock import patch

        with patch('accounts.views.RefreshToken.blacklist',
                   side_effect=RuntimeError('simulated blacklist failure')):
            with self.assertRaises(RuntimeError):
                self.client.post('/api/auth/register/', {
                    'email': 'must-rollback@example.com',
                    'password': 'strong-password-123',
                }, format='json', HTTP_X_POMAK_CLIENT='web')

        self.assertFalse(User.objects.filter(email='must-rollback@example.com').exists())
