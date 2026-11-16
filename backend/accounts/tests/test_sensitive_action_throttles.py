"""Independent hourly account-action limits, integration-tested through API routes."""

from unittest.mock import patch

from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import AuthThrottleBucket, User


@override_settings(ACCOUNT_EMAIL_ENABLED=True)
class SensitiveActionThrottleTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('sensitive@example.com', 'strong-password-123')
        self.client.force_authenticate(self.user)

    def test_exhausted_email_resend_does_not_lock_password_change_or_deletion(self):
        with patch('accounts.recovery_views.send_verification_email_safe') as send:
            for _ in range(5):
                self.assertEqual(self.client.post('/api/auth/email/resend/', {}, format='json').status_code, 204)
            self.assertEqual(self.client.post('/api/auth/email/resend/', {}, format='json').status_code, 429)
            self.assertEqual(send.call_count, 5)

        wrong_change = {'old_password': 'incorrect', 'new_password': 'another-strong-password-456'}
        self.assertEqual(self.client.post('/api/auth/password/change/', wrong_change, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/auth/me/delete/', {'password': 'incorrect'}, format='json').status_code, 400)

        for _ in range(4):
            self.assertEqual(self.client.post('/api/auth/password/change/', wrong_change, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/auth/password/change/', wrong_change, format='json').status_code, 429)
        for _ in range(4):
            self.assertEqual(self.client.post('/api/auth/me/delete/', {'password': 'incorrect'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/auth/me/delete/', {'password': 'incorrect'}, format='json').status_code, 429)

        self.assertEqual(AuthThrottleBucket.objects.count(), 3)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_another_account_gets_its_own_hourly_budget(self):
        for _ in range(6):
            result = self.client.post('/api/auth/me/delete/', {'password': 'wrong'}, format='json')
        self.assertEqual(result.status_code, 429)
        another = User.objects.create_user('other-sensitive@example.com', 'strong-password-123')
        self.client.force_authenticate(another)
        self.assertEqual(self.client.post('/api/auth/me/delete/', {'password': 'wrong'}, format='json').status_code, 400)
