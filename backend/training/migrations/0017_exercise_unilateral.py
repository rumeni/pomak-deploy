from django.db import migrations, models

# Frozen copy of exercise_library.UNILATERAL at the time of this migration.
UNILATERAL = {
    'bulgarian-split-squat', 'split-squat', 'dumbbell-lunge', 'walking-lunge', 'reverse-lunge', 'lateral-lunge',
    'step-up', 'dumbbell-row', 'single-arm-cable-row', 'concentration-curl', 'dumbbell-kickback',
    'cable-kickback', 'cable-lateral-raise', 'landmine-press', 'donkey-kick', 'fire-hydrant',
    'single-leg-glute-bridge', 'side-plank', 'pallof-press', 'turkish-get-up',
}


def mark(apps, schema_editor):
    """Library exercises done one side at a time. Users' own exercises stay as they are."""
    Exercise = apps.get_model('training', 'Exercise')
    Exercise.objects.filter(owner__isnull=True, slug__in=UNILATERAL).update(unilateral=True)


class Migration(migrations.Migration):

    dependencies = [
        ('training', '0016_superset'),
    ]

    operations = [
        migrations.AddField(
            model_name='exercise',
            name='unilateral',
            field=models.BooleanField(db_default=False, default=False),
        ),
        migrations.RunPython(mark, migrations.RunPython.noop),
    ]
