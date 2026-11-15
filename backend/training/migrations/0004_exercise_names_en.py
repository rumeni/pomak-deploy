from django.db import migrations

from core.text import normalize_search
from training.exercise_library import NAMES_EN


def fill_english_names(apps, schema_editor):
    Exercise = apps.get_model('training', 'Exercise')
    for exercise in Exercise.objects.filter(slug__in=NAMES_EN):
        exercise.name_en = NAMES_EN[exercise.slug]
        exercise.search_name = normalize_search(f'{exercise.name} {exercise.name_en} {exercise.aliases}')
        exercise.save(update_fields=['name_en', 'search_name'])


class Migration(migrations.Migration):
    dependencies = [('training', '0003_exercise_name_en_alter_exercise_aliases_and_more')]

    operations = [migrations.RunPython(fill_english_names, migrations.RunPython.noop)]
