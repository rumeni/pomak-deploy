from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('training', '0015_exercise_client_copy_of_coach_exercise'),
    ]

    operations = [
        migrations.AddField(
            model_name='routineexercise',
            name='superset',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='sessionexercise',
            name='superset',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
