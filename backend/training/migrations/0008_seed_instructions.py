from django.db import migrations

from training.data.instructions import INSTRUCTIONS


def seed(apps, schema_editor):
    """Uputstva (koraci jedan po redu) za vežbe iz zajedničke biblioteke, na srpskom i engleskom."""
    Exercise = apps.get_model('training', 'Exercise')
    for slug, text in INSTRUCTIONS.items():
        Exercise.objects.filter(owner__isnull=True, slug=slug).update(
            instructions='\n'.join(text['sr']), instructions_en='\n'.join(text['en']),
        )


def unseed(apps, schema_editor):
    Exercise = apps.get_model('training', 'Exercise')
    Exercise.objects.filter(owner__isnull=True).update(instructions='', instructions_en='')


class Migration(migrations.Migration):
    dependencies = [
        ('training', '0007_exercise_instructions_en'),
    ]

    operations = [migrations.RunPython(seed, unseed)]
