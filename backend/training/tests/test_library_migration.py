import importlib

from django.conf import settings
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

ADDED = importlib.import_module('training.migrations.0014_more_exercises').NEW

BEFORE = [('training', '0013_routine_program_key')]
AFTER = [('training', '0014_more_exercises')]
NEW = {'hack-squat', 'cable-curl', 'side-plank', 'elliptical', 'turkish-get-up'}


class LibraryUpgradeTests(TransactionTestCase):
    """0013 → 0014 as in production: the new exercises arrive, everything existing stays as it was.

    Older seed migrations read the live library module, so a fresh database already has the new
    rows before 0014; here they are removed first to reproduce a database seeded earlier.
    """

    # The seeded library is restored afterwards for the tests that follow.
    serialized_rollback = True

    @classmethod
    def _fixture_setup(cls):
        # Other TransactionTestCase classes may have emitted post_migrate and
        # recreated content types after their flush. Serialized rollback would
        # try to insert those same rows again (UNIQUE app_label/model).
        # Empty the isolated TEST database without firing post_migrate before
        # Django restores its migrated seed snapshot.
        call_command('flush', verbosity=0, interactive=False, inhibit_post_migrate=True)
        super()._fixture_setup()

    def migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        self.migrate(executor_leaf_nodes())

    def test_upgrade_adds_new_exercises_and_keeps_existing_ones(self):
        apps = self.migrate(BEFORE)
        Exercise = apps.get_model('training', 'Exercise')
        Routine = apps.get_model('training', 'Routine')
        RoutineExercise = apps.get_model('training', 'RoutineExercise')
        User = apps.get_model(settings.AUTH_USER_MODEL)

        Exercise.objects.filter(slug__in=ADDED, owner__isnull=True).delete()
        before = dict(Exercise.objects.filter(owner__isnull=True).values_list('slug', 'pk'))
        self.assertTrue(NEW.isdisjoint(before))

        user = User.objects.create(email='lib@example.com', password='!')
        routine = Routine.objects.create(owner_id=user.pk, name='Moja')
        bench = Exercise.objects.get(slug='bench-press')
        RoutineExercise.objects.create(routine=routine, exercise=bench, position=0)
        edited = Exercise.objects.get(slug='plank')
        edited.instructions = 'Moje beleške'
        edited.save()

        apps = self.migrate(AFTER)
        Exercise = apps.get_model('training', 'Exercise')
        RoutineExercise = apps.get_model('training', 'RoutineExercise')

        after = dict(Exercise.objects.filter(owner__isnull=True).values_list('slug', 'pk'))
        self.assertTrue(NEW <= set(after))
        self.assertEqual(len(after), len(before) + len(ADDED))
        # Existing rows keep their IDs, a routine keeps its exercise, untouched rows stay untouched.
        self.assertEqual({slug: after[slug] for slug in before}, before)
        self.assertEqual(RoutineExercise.objects.get(routine_id=routine.pk).exercise_id, bench.pk)
        self.assertEqual(Exercise.objects.get(slug='plank').instructions, 'Moje beleške')
        new = Exercise.objects.get(slug='hack-squat')
        self.assertTrue(new.name_en and new.instructions and new.instructions_en)


def executor_leaf_nodes():
    executor = MigrationExecutor(connection)
    return executor.loader.graph.leaf_nodes()
