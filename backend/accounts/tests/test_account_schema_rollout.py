"""Deployment compatibility regression for accounts.0006 on PostgreSQL."""

from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.db import connection
from django.db.migrations.loader import MigrationLoader

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

    def test_legacy_orm_can_insert_user_without_new_columns(self):
        # Use the actual historical model from before accounts.0006, exactly
        # as the still-running old backend would during the schema-first rollout.
        loader = MigrationLoader(connection)
        legacy_apps = loader.project_state([('accounts', '0005_auththrottlebucket')]).apps
        LegacyUser = legacy_apps.get_model('accounts', 'User')
        legacy = LegacyUser.objects.create(
            email='legacy-db-default@example.com', password='!disabled',
        )
        user = User.objects.get(pk=legacy.pk)
        self.assertEqual(user.session_version, 0)
        self.assertFalse(user.email_verification_required)
