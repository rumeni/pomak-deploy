import io
import os
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from accounts.maintenance import cleanup_expired_auth_throttle_buckets
from accounts.models import AuthThrottleBucket


class AuthThrottleCleanupTests(TestCase):
    def setUp(self):
        self.now = timezone.now().replace(second=0, microsecond=0)
        self.old = AuthThrottleBucket.objects.create(key='old', window_start=self.now - timedelta(hours=3))
        self.just_old = AuthThrottleBucket.objects.create(
            key='just-old', window_start=self.now - timedelta(hours=2, seconds=1),
        )
        self.current_minute = AuthThrottleBucket.objects.create(key='current', window_start=self.now)
        self.current_hour = AuthThrottleBucket.objects.create(
            key='delete-password-hour', window_start=self.now.replace(minute=0),
        )

    def test_only_rows_older_than_two_hours_are_deleted(self):
        removed, more = cleanup_expired_auth_throttle_buckets(now=self.now)
        self.assertEqual(removed, 2)
        self.assertFalse(more)
        self.assertCountEqual(
            AuthThrottleBucket.objects.values_list('key', flat=True),
            ['current', 'delete-password-hour'],
        )
        removed_again, more_again = cleanup_expired_auth_throttle_buckets(now=self.now)
        self.assertEqual((removed_again, more_again), (0, False))

    def test_bounded_batches_keep_expired_rows_for_next_run(self):
        removed, more = cleanup_expired_auth_throttle_buckets(
            now=self.now, batch_size=1, max_batches=1,
        )
        self.assertEqual(removed, 1)
        self.assertTrue(more)
        removed_again, more_again = cleanup_expired_auth_throttle_buckets(
            now=self.now, batch_size=1, max_batches=2,
        )
        self.assertEqual(removed_again, 1)
        self.assertFalse(more_again)

    def test_management_command_matches_cron_cleanup(self):
        output = io.StringIO()
        call_command('cleanup_auth_throttle', stdout=output)
        self.assertIn('Deleted 2 expired auth throttle buckets', output.getvalue())

    def test_cron_never_runs_without_configured_secret(self):
        with patch.dict(os.environ, {}, clear=True):
            response = self.client.get('/api/internal/cleanup-auth-throttle/')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(AuthThrottleBucket.objects.count(), 4)

    def test_cron_rejects_bad_or_missing_authorization(self):
        with patch.dict(os.environ, {'CRON_SECRET': 'integration-test-only'}):
            self.assertEqual(self.client.get('/api/internal/cleanup-auth-throttle/').status_code, 401)
            self.assertEqual(
                self.client.get('/api/internal/cleanup-auth-throttle/', HTTP_AUTHORIZATION='Bearer incorrect').status_code,
                401,
            )
        self.assertEqual(AuthThrottleBucket.objects.count(), 4)

    def test_cron_authenticates_and_deletes_only_expired_rows(self):
        with patch.dict(os.environ, {'CRON_SECRET': 'integration-test-only'}):
            response = self.client.get(
                '/api/internal/cleanup-auth-throttle/',
                HTTP_AUTHORIZATION='Bearer integration-test-only',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['deleted'], 2)
        self.assertFalse(response.json()['more_expired'])
        self.assertEqual(AuthThrottleBucket.objects.count(), 2)

    def test_cron_disallows_post_even_with_secret(self):
        with patch.dict(os.environ, {'CRON_SECRET': 'integration-test-only'}):
            self.assertEqual(
                self.client.post(
                    '/api/internal/cleanup-auth-throttle/',
                    HTTP_AUTHORIZATION='Bearer integration-test-only',
                ).status_code,
                405,
            )
