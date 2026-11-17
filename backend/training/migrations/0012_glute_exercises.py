from django.db import migrations

from core.text import normalize_search
from training.data.instructions import INSTRUCTIONS
from training.exercise_library import EXERCISES, NAMES_EN

NEW = {'glute-bridge', 'hip-abduction', 'cable-kickback', 'step-up', 'sumo-deadlift'}


def seed(apps, schema_editor):
    """New shared exercises (mainly glutes) for the suggested programs."""
    Exercise = apps.get_model('training', 'Exercise')
    for slug, name, aliases, equipment, measurement, muscle, load_mode in EXERCISES:
        if slug not in NEW:
            continue
        name_en = NAMES_EN.get(slug, '')
        text = INSTRUCTIONS.get(slug, {'sr': [], 'en': []})
        Exercise.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name, 'name_en': name_en, 'aliases': aliases,
                'search_name': normalize_search(f'{name} {name_en} {aliases}'),
                'equipment': equipment, 'measurement': measurement, 'muscle': muscle, 'load_mode': load_mode,
                'instructions': '\n'.join(text['sr']), 'instructions_en': '\n'.join(text['en']),
            },
        )


class Migration(migrations.Migration):
    dependencies = [('training', '0011_workoutsession_edited_at')]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
