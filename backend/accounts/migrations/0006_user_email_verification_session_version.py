import uuid

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0005_auththrottlebucket'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='session_version',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verification_required',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='AccountEmailJob',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[('reset', 'Password reset'), ('verify', 'Email verification')], max_length=10)),
                ('email', models.EmailField(max_length=254)),
                ('requested_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('available_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
                ('claimed_at', models.DateTimeField(blank=True, null=True)),
                ('claim_id', models.UUIDField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={'indexes': [models.Index(fields=['completed_at', 'available_at'], name='email_job_state_idx')]},
        ),
    ]
