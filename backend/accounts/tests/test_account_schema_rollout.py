"""Deployment compatibility regression for accounts.0006 on PostgreSQL."""

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from accounts.models import User


class AccountSchemaRolloutTests(TestCase):
    def test_migration_keeps_database_defaults_for_legacy_registration(self):
        # The old production backend inserts users without these new columns.
        # Both must retain DB defaults after migration, until all old instances
        # are drained. Python's default= alone is NOT sufficient.
        self.assertEqual(User._meta.get_field('session_version').db_default, 0)
        self.assertIs(User._meta.get_field('email_verification_required').db_default, False)

        output = StringIO()
        call_command('sqlmigrate', 'accounts', '0006', stdout=output)
        sql = output.getvalue().upper()
        self.assertIn('SESSION_VERSION', sql)
        self.assertIn('EMAIL_VERIFICATION_REQUIRED', sql)
        self.assertIn('DEFAULT', sql)
        self.assertNotIn('DROP DEFAULT', sql)
