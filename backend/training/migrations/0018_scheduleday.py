import uuid

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('training', '0017_exercise_unilateral'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ScheduleDay',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('weekday', models.PositiveSmallIntegerField(validators=[django.core.validators.MaxValueValidator(6)])),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='schedule_days', to=settings.AUTH_USER_MODEL)),
                ('routine', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='training.routine')),
            ],
            options={
                'ordering': ['weekday'],
                'constraints': [models.UniqueConstraint(fields=('owner', 'weekday'), name='schedule_one_routine_per_day')],
            },
        ),
    ]
