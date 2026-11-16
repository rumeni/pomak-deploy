"""Account email recovery and session revocation behavior, with in-memory mail."""

import base64
import hashlib
import json
import time
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import jwt

from django.core import mail
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import User


EMAIL_TEST_SETTINGS = {
    'ACCOUNT_EMAIL_ENABLED': True,
    'ACCOUNT_EMAIL_BASE_URL': 'https://pomak-web.example',
    'EMAIL_BACKEND': 'django.core.mail.backends.locmem.EmailBackend',
    'DEFAULT_FROM_EMAIL': 'POMAK <noreply@pomak.example>',
    'ACCOUNT_EMAIL_WORKER_URL': 'https://api.pomak.example/api/internal/password-reset-email/',
    'QSTASH_TOKEN': 'test-only-publish-token',
    'QSTASH_CURRENT_SIGNING_KEY': 'test-only-signing-key',
    'QSTASH_NEXT_SIGNING_KEY': 'test-only-next-signing-key',
}


def email_params(message):
    link = next(part for part in message.body.split() if part.startswith('https://'))
    return {key: values[0] for key, values in parse_qs(urlparse(link).query).items()}


@override_settings(**EMAIL_TEST_SETTINGS)
class PasswordRecoveryTests(APITestCase):
    def setUp(self):
        mail.outbox.clear()
        self.user = User.objects.create_user('recover@example.com', 'strong-old-password-123')

    def request_reset(self, email):
        with patch('accounts.recovery_views.urlopen') as publisher:
            publisher.return_value.__enter__.return_value.status = 200
            response = self.client.post('/api/auth/password/reset/request/', {'email': email}, format='json')
            if response.status_code == 202:
                self.assertEqual(publisher.call_count, 1)
                request = publisher.call_args.args[0]
                self.assertEqual(json.loads(request.data)['email'], email.lower())
                self.assertEqual(request.get_header('Upstash-redact-fields'), 'body')
            return response

    def deliver_reset(self, email, signing_key='test-only-signing-key'):
        raw = json.dumps({'email': email}, separators=(',', ':')).encode('utf-8')
        now = int(time.time())
        token = jwt.encode({
            'iss': 'Upstash',
            'sub': EMAIL_TEST_SETTINGS['ACCOUNT_EMAIL_WORKER_URL'],
            'iat': now, 'nbf': now - 1, 'exp': now + 60,
            'body': base64.urlsafe_b64encode(hashlib.sha256(raw).digest()).decode('ascii').rstrip('='),
        }, signing_key, algorithm='HS256')
        return self.client.post('/api/internal/password-reset-email/', data=raw,
                                content_type='application/json', HTTP_UPSTASH_SIGNATURE=token)

    def test_unknown_address_uses_identical_public_response(self):
        known = self.request_reset('recover@example.com')
        unknown = self.request_reset('unknown@example.com')
        self.assertEqual(known.status_code, 202)
        self.assertEqual(unknown.status_code, 202)
        self.assertEqual(known.data, unknown.data)
        # No lookup or SMTP call takes place in the public request path.
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(self.deliver_reset('unknown@example.com').status_code, 204)
        self.assertEqual(self.deliver_reset('recover@example.com').status_code, 204)
        self.assertEqual(len(mail.outbox), 1)

    def test_reset_changes_password_and_invalidates_access_and_refresh(self):
        login = self.client.post('/api/auth/login/', {
            'email': 'recover@example.com', 'password': 'strong-old-password-123',
        }, format='json')
        self.assertEqual(login.status_code, 200, login.data)
        old_access, old_refresh = login.data['access'], login.data['refresh']

        self.assertEqual(self.request_reset('recover@example.com').status_code, 202)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(self.deliver_reset('recover@example.com').status_code, 204)
        self.assertEqual(len(mail.outbox), 1)
        params = email_params(mail.outbox[0])
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', {
            **params, 'new_password': 'strong-new-password-456',
        }, format='json').status_code, 204)

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {old_access}')
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post('/api/auth/refresh/', {
            'refresh': old_refresh,
        }, format='json').status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login/', {
            'email': 'recover@example.com', 'password': 'strong-old-password-123',
        }, format='json').status_code, 401)
        relogin = self.client.post('/api/auth/login/', {
            'email': 'recover@example.com', 'password': 'strong-new-password-456',
        }, format='json')
        self.assertEqual(relogin.status_code, 200, relogin.data)
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', {
            **params, 'new_password': 'another-secure-password-789',
        }, format='json').status_code, 400)

    def test_change_password_rejects_wrong_old_password_then_revokes_sessions(self):
        login = self.client.post('/api/auth/login/', {
            'email': 'recover@example.com', 'password': 'strong-old-password-123',
        }, format='json')
        access = login.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        invalid = self.client.post('/api/auth/password/change/', {
            'old_password': 'incorrect',
            'new_password': 'strong-new-password-456',
        }, format='json')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)
        valid = self.client.post('/api/auth/password/change/', {
            'old_password': 'strong-old-password-123',
            'new_password': 'strong-new-password-456',
        }, format='json')
        self.assertEqual(valid.status_code, 204, valid.data)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)

    def test_reset_daily_limits_apply_to_known_and_unknown_emails(self):
        for _ in range(3):
            self.assertEqual(self.request_reset('recover@example.com').status_code, 202)
        # A fourth request is rejected by the daily email limit, not SMTP.
        self.assertEqual(self.request_reset('recover@example.com').status_code, 429)
        for _ in range(3):
            self.assertEqual(self.request_reset('unknown@example.com').status_code, 202)
        self.assertEqual(self.request_reset('unknown@example.com').status_code, 429)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_daily_ip_limit_is_independent_of_email(self):
        from rest_framework.parsers import JSONParser
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory
        from accounts.throttles import PasswordResetThrottle

        factory = APIRequestFactory()
        with patch('accounts.throttles.RESET_PER_IP_PER_DAY', 3):
            for n in range(4):
                request = Request(factory.post(
                    '/api/auth/password/reset/request/',
                    {'email': f'different{n}@example.com'},
                    format='json', REMOTE_ADDR='192.0.2.99',
                ), parsers=[JSONParser()])
                allowed = PasswordResetThrottle().allow_request(request, None)
                self.assertEqual(allowed, n < 3)

    def test_reset_daily_global_and_source_budgets_are_atomic(self):
        from rest_framework.parsers import JSONParser
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory
        from accounts.throttles import PasswordResetThrottle

        factory = APIRequestFactory()

        def try_throttle(ip, email):
            request = Request(factory.post(
                '/api/auth/password/reset/request/', {'email': email},
                format='json', REMOTE_ADDR=ip,
            ), parsers=[JSONParser()])
            return PasswordResetThrottle().allow_request(request, None)

        with patch('accounts.throttles.RESET_GLOBAL_PER_DAY', 3):
            for n in range(3):
                self.assertTrue(try_throttle(f'192.0.2.{n+1}', f'user{n}@example.com'))
            # Each sender below has a fresh IP and address. The shared queue
            # budget still refuses the fourth publication.
            self.assertFalse(try_throttle('192.0.2.10', 'user10@example.com'))

    def test_qstash_worker_requires_valid_signature_and_body_hash(self):
        raw = b'{"email":"recover@example.com"}'
        unsigned = self.client.post('/api/internal/password-reset-email/', data=raw,
                                    content_type='application/json')
        self.assertEqual(unsigned.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)
        signed = self.deliver_reset('recover@example.com', signing_key='wrong-key')
        self.assertEqual(signed.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)

    def test_queue_failure_returns_same_error_without_account_disclosure(self):
        for address in ('recover@example.com', 'nobody@example.com'):
            with patch('accounts.recovery_views.urlopen', side_effect=OSError('provider unavailable')):
                response = self.client.post('/api/auth/password/reset/request/',
                                            {'email': address}, format='json')
            self.assertEqual(response.status_code, 503)
        self.assertEqual(len(mail.outbox), 0)

    def test_bad_uid_or_token_cannot_change_password(self):
        invalid = self.client.post('/api/auth/password/reset/confirm/', {
            'uid': 'not-valid', 'token': 'bad-token',
            'new_password': 'strong-new-password-456',
        }, format='json')
        self.assertEqual(invalid.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('strong-old-password-123'))
        # A decodable value that isn't a UUID is also a client error, never 500.
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        uid = urlsafe_base64_encode(force_bytes('not-a-uuid'))
        res = self.client.post('/api/auth/password/reset/confirm/', {
            'uid': uid, 'token': 'invalid', 'new_password': 'strong-new-password-456',
        }, format='json')
        self.assertEqual(res.status_code, 400)


@override_settings(**EMAIL_TEST_SETTINGS)
class EmailConfirmationTests(APITestCase):
    def setUp(self):
        mail.outbox.clear()

    def test_unverified_signup_is_gated_until_one_time_confirmation(self):
        with self.captureOnCommitCallbacks(execute=True):
            registered = self.client.post('/api/auth/register/', {
                'email': 'verify@example.com',
                'password': 'strong-password-123',
            }, format='json')
        self.assertEqual(registered.status_code, 201, registered.data)
        self.assertEqual(len(mail.outbox), 1)
        access = registered.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        me = self.client.get('/api/auth/me/')
        self.assertEqual(me.status_code, 200)
        self.assertTrue(me.data['email_verification_required'])
        self.assertFalse(me.data['email_verified'])
        self.assertEqual(self.client.get('/api/nutrition/foods/').status_code, 403)
        # A client cannot disable its own email-verification requirement.
        bypass = self.client.patch('/api/auth/me/', {
            'email_verification_required': False,
        }, format='json')
        self.assertEqual(bypass.status_code, 200, bypass.data)
        self.assertTrue(bypass.data['email_verification_required'])
        self.assertTrue(User.objects.get(email='verify@example.com').email_verification_required)

        # Operators can disable enforcement during rollback without locking
        # accounts that registered under the email-verification rollout.
        with override_settings(ACCOUNT_EMAIL_ENABLED=False):
            rolled_back = self.client.get('/api/auth/me/')
            self.assertFalse(rolled_back.data['email_verification_required'])
            self.assertEqual(self.client.get('/api/nutrition/foods/').status_code, 200)

        self.client.credentials()
        token = email_params(mail.outbox[0])['token']
        self.assertEqual(self.client.post('/api/auth/email/verify/', {
            'token': token,
        }, format='json').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/email/verify/', {
            'token': token,
        }, format='json').status_code, 400)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        self.assertEqual(self.client.get('/api/nutrition/foods/').status_code, 200)

    def test_unverified_account_can_delete_itself(self):
        registered = self.client.post('/api/auth/register/', {
            'email': 'remove-unverified@example.com',
            'password': 'strong-password-123',
        }, format='json')
        self.assertEqual(registered.status_code, 201, registered.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {registered.data['access']}")
        self.assertEqual(self.client.get('/api/nutrition/foods/').status_code, 403)

        deleted = self.client.post('/api/auth/me/delete/', {
            'password': 'strong-password-123',
        }, format='json')
        self.assertEqual(deleted.status_code, 204, getattr(deleted, 'data', None))
        self.assertFalse(User.objects.filter(email='remove-unverified@example.com').exists())

    def test_expired_or_tampered_email_link_is_rejected(self):
        user = User.objects.create_user(
            'verify-bad@example.com', 'strong-password-123',
            email_verification_required=True,
        )
        from accounts.email_security import email_verification_token
        token = email_verification_token(user)
        invalid = self.client.post('/api/auth/email/verify/', {
            'token': token + 'tampered',
        }, format='json')
        self.assertEqual(invalid.status_code, 400)


class DisabledAccountEmailsTests(APITestCase):
    @override_settings(ACCOUNT_EMAIL_ENABLED=False)
    def test_no_false_promise_when_email_provider_is_disabled(self):
        res = self.client.post('/api/auth/password/reset/request/', {
            'email': 'someone@example.com',
        }, format='json')
        self.assertEqual(res.status_code, 503)
