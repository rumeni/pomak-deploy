"""Preserve the intended workout for idempotent coach-message retries after workout deletion."""

from django.db import migrations, models


def backfill_workout_context(apps, schema_editor):
    CoachMessage = apps.get_model('coaching', 'CoachMessage')
    CoachMessage.objects.filter(workout_id__isnull=False).update(workout_context_id=models.F('workout_id'))


class Migration(migrations.Migration):
    dependencies = [
        ('coaching', '0003_coach_plans_reviews'),
    ]

    operations = [
        migrations.AddField(
            model_name='coachmessage',
            name='workout_context_id',
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_workout_context, migrations.RunPython.noop),
    ]
