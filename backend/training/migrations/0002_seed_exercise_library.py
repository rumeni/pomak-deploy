from django.db import migrations

from core.text import normalize_search
from training.exercise_library import EXERCISES


def seed(apps, schema_editor):
    Exercise = apps.get_model('training', 'Exercise')
    for slug, name, aliases, equipment, measurement, muscle, load_mode in EXERCISES:
        Exercise.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name,
                'aliases': aliases,
                'search_name': normalize_search(f'{name} {aliases}'),
                'equipment': equipment,
                'measurement': measurement,
                'muscle': muscle,
                'load_mode': load_mode,
            },
        )


class Migration(migrations.Migration):
    dependencies = [('training', '0001_initial')]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
