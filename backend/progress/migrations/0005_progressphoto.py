import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('progress', '0004_weekly_checkin'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ProgressPhoto',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('taken_on', models.DateField()),
                ('pose', models.CharField(choices=[('front', 'From the front'), ('side', 'From the side'), ('back', 'From behind')], default='front', max_length=10)),
                ('note', models.CharField(blank=True, max_length=200)),
                ('data', models.BinaryField()),
                ('width', models.PositiveIntegerField()),
                ('height', models.PositiveIntegerField()),
                ('size', models.PositiveIntegerField(default=0)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='progress_photos', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-taken_on', '-created_at'],
                'indexes': [models.Index(fields=['user', '-taken_on'], name='progress_photo_user_day_idx')],
            },
        ),
    ]
