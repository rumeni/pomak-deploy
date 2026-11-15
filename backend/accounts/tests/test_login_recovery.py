"""Issue #6: a target account can recover without a password-only bypass."""

import io
import json
import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase, APITransactionTestCase

from accounts.models import AuthThrottleBucket, User
from accounts.turnstile import claim_login_recovery_token, verify_login_recovery


@override_settings(
    TURNSTILE_LOGIN_ENABLED=True,
    TURNSTILE_SECRET_KEY='test-secret-not-a-production-credential',
    TURNSTILE_ALLOWED_HOSTNAMES=['pomak.example'],
)
class LoginRecoveryTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('target@example.com', 'jaka-lozinka-123')

    def login(self, password, ip, token=None, email='target@example.com'):
        payload = {'email': email, 'password': password}
        if token is not None:
            payload['turnstile_token'] = token
        return self.client.post('/api/auth/login/', payload, format='json', REMOTE_ADDR=ip)

    def exhaust_account_without_owning_any_credentials(self):
        for i in range(10):
            response = self.login('invalid-password', f'198.51.100.{i + 1}')
            self.assertEqual(response.status_code, 401, response.data)

    @patch('accounts.throttles.verify_login_recovery', return_value=True)
    def test_correct_password_with_human_challenge_survives_distributed_lockout(self, verify):
        self.exhaust_account_without_owning_any_credentials()
        blocked = self.login('jaka-lozinka-123', '203.0.113.1')
        self.assertEqual(blocked.status_code, 429, blocked.data)
        self.assertEqual(str(blocked.data['code']), 'login_verification_required')
        self.assertEqual(verify.call_count, 0)

        recovered = self.login('jaka-lozinka-123', '203.0.113.1', 'single-use-siteverify-token')
        self.assertEqual(recovered.status_code, 200, recovered.data)
        self.assertIn('refresh', recovered.data)
        verify.assert_called_once_with('single-use-siteverify-token', '203.0.113.1')

    @patch('accounts.throttles.verify_login_recovery', return_value=False)
    def test_forged_token_does_not_bypass_quota_or_reveal_account_status(self, verify):
        self.exhaust_account_without_owning_any_credentials()
        rejected = self.login('jaka-lozinka-123', '203.0.113.2', 'forged-token')
        self.assertEqual(rejected.status_code, 429)
        self.assertEqual(str(rejected.data['code']), 'login_verification_required')
        verify.assert_called_once()

        # Exhausted email quotas are checked before user lookup, even for an
        # email that has never belonged to an account.
        for i in range(10):
            self.login('invalid-password', f'192.0.2.{i + 1}', email='missing@example.com')
        missing = self.login('invalid-password', '192.0.2.70', email='missing@example.com')
        self.assertEqual(missing.status_code, 429)
        self.assertEqual(str(missing.data['code']), 'login_verification_required')

    @patch('accounts.throttles.verify_login_recovery', return_value=True)
    def test_verified_wrong_password_attempts_still_have_a_shared_account_limit(self, verify):
        self.exhaust_account_without_owning_any_credentials()
        for i in range(2):
            res = self.login('still-wrong', f'203.0.113.{i + 10}', f'unique-token-{i}')
            self.assertEqual(res.status_code, 401, res.data)
        blocked = self.login('jaka-lozinka-123', '203.0.113.12', 'third-token')
        self.assertEqual(blocked.status_code, 429, blocked.data)
        self.assertNotIn('code', blocked.data)  # No futile prompt: the minute's recovery budget is spent.
        self.assertEqual(verify.call_count, 3)

    @patch('accounts.throttles.verify_login_recovery', return_value=True)
    def test_unverified_attempts_cannot_deplete_verified_recovery_allowance(self, verify):
        self.exhaust_account_without_owning_any_credentials()
        for i in range(4):
            self.assertEqual(self.login('invalid', f'192.0.2.{i + 40}').status_code, 429)
        good = self.login('jaka-lozinka-123', '192.0.2.200', 'valid-token')
        self.assertEqual(good.status_code, 200, good.data)
        verify.assert_called_once()

    @patch('accounts.throttles.verify_login_recovery', return_value=True)
    def test_verified_token_cannot_be_replayed_across_accounts(self, verify):
        self.exhaust_account_without_owning_any_credentials()
        User.objects.create_user('second@example.com', 'jaka-lozinka-123')
        for i in range(10):
            response = self.login('invalid', f'192.0.2.{i + 1}', email='second@example.com')
            self.assertEqual(response.status_code, 401, response.data)

        first = self.login('incorrect', '203.0.113.31', 'same-siteverify-token')
        self.assertEqual(first.status_code, 401, first.data)
        replay = self.login(
            'jaka-lozinka-123', '203.0.113.32', 'same-siteverify-token',
            email='second@example.com',
        )
        self.assertEqual(replay.status_code, 429, replay.data)
        self.assertEqual(str(replay.data['code']), 'login_verification_required')
        self.assertEqual(verify.call_count, 2)

    @patch('accounts.throttles.verify_login_recovery', side_effect=[False, True])
    def test_failed_siteverify_does_not_consume_token(self, verify):
        self.exhaust_account_without_owning_any_credentials()
        first = self.login('jaka-lozinka-123', '203.0.113.42', 'temporarily-unavailable-token')
        self.assertEqual(first.status_code, 429)
        second = self.login('jaka-lozinka-123', '203.0.113.42', 'temporarily-unavailable-token')
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(verify.call_count, 2)

    def test_oversized_token_fails_closed_without_network_request(self):
        self.exhaust_account_without_owning_any_credentials()
        with patch('accounts.throttles.verify_login_recovery') as verify:
            res = self.login('jaka-lozinka-123', '203.0.113.22', 'x' * 2049)
        self.assertEqual(res.status_code, 429)
        verify.assert_not_called()


class DisabledLoginRecoveryTests(APITestCase):
    @override_settings(TURNSTILE_LOGIN_ENABLED=False)
    def test_old_account_cap_is_unchanged_until_explicitly_enabled(self):
        User.objects.create_user('safe@example.com', 'jaka-lozinka-123')
        for idx in range(10):
            response = self.client.post('/api/auth/login/', {
                'email': 'safe@example.com', 'password': 'wrong',
            }, format='json', REMOTE_ADDR=f'198.51.100.{idx + 1}')
            self.assertEqual(response.status_code, 401)
        response = self.client.post('/api/auth/login/', {
            'email': 'safe@example.com', 'password': 'jaka-lozinka-123',
            'turnstile_token': 'forged',
        }, format='json', REMOTE_ADDR='203.0.113.2')
        self.assertEqual(response.status_code, 429)
        self.assertNotIn('code', response.data)


@override_settings(
    TURNSTILE_LOGIN_ENABLED=True,
    TURNSTILE_SECRET_KEY='test-secret',
    TURNSTILE_ALLOWED_HOSTNAMES=['pomak.example'],
)
class SiteverifyTests(APITestCase):
    @staticmethod
    def fake_response(fields):
        class Response(io.BytesIO):
            status = 200
        return Response(json.dumps(fields).encode('utf-8'))

    def test_requires_proper_hostname_action_and_success(self):
        ok = {'success': True, 'action': 'pomak_login_recovery', 'hostname': 'pomak.example'}
        with patch('accounts.turnstile.urlopen', return_value=self.fake_response(ok)) as call:
            self.assertTrue(verify_login_recovery('token123', '192.0.2.22'))
            request = call.call_args.args[0]
            self.assertEqual(request.full_url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
            self.assertIn(b'response=token123', request.data)
            self.assertEqual(call.call_args.kwargs['timeout'], 3)
        for invalid in [
            {**ok, 'hostname': 'evil.example'},
            {**ok, 'action': 'different_action'},
            {**ok, 'success': False},
            {**ok, 'hostname': None},
        ]:
            with self.subTest(invalid=invalid):
                with patch('accounts.turnstile.urlopen', return_value=self.fake_response(invalid)):
                    self.assertFalse(verify_login_recovery('token123', '192.0.2.22'))

    def test_provider_failure_fails_closed(self):
        from urllib.error import URLError

        with patch('accounts.turnstile.urlopen', side_effect=URLError('offline')):
            self.assertFalse(verify_login_recovery('token123', '192.0.2.22'))
        with patch('accounts.turnstile.urlopen', return_value=self.fake_response('not-json')):
            self.assertFalse(verify_login_recovery('token123', '192.0.2.22'))


class TurnstileReplayAtomicityTests(APITransactionTestCase):
    """Real PostgreSQL concurrency regression; test each worker on its own connection."""

    def test_two_parallel_claims_of_same_token_admit_only_one(self):
        barrier = Barrier(2)

        def claim_in_parallel():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return claim_login_recovery_token('a-valid-replayed-turnstile-token')
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: claim_in_parallel(), range(2)))
        self.assertEqual(sorted(results), [False, True])

        token_hash = hashlib.sha256(
            b'turnstile-recovery:a-valid-replayed-turnstile-token',
        ).hexdigest()
        self.assertEqual(AuthThrottleBucket.objects.filter(key=token_hash).count(), 1)

    def test_expired_claim_can_be_pruned_and_does_not_block_forever(self):
        token = 'five-minute-window-test'
        self.assertTrue(claim_login_recovery_token(token))
        key = hashlib.sha256(f'turnstile-recovery:{token}'.encode('utf-8')).hexdigest()
        AuthThrottleBucket.objects.filter(key=key).update(
            window_start=timezone.now() - timedelta(minutes=6),
        )
        self.assertTrue(claim_login_recovery_token(token))
        self.assertEqual(AuthThrottleBucket.objects.filter(key=key).count(), 2)
