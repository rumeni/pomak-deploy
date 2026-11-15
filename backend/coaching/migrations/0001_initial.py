import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

from coaching.models import invite_code, invite_expires_at


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('accounts', '0005_auththrottlebucket'),
        ('training', '0008_seed_instructions'),
    ]

    operations = [
        migrations.CreateModel(
            name='CoachInvitation',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('code', models.CharField(max_length=16, unique=True, default=invite_code)),
                ('expires_at', models.DateTimeField(default=invite_expires_at)),
                ('redeemed_at', models.DateTimeField(null=True, blank=True)),
                ('revoked_at', models.DateTimeField(null=True, blank=True)),
                ('coach', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='coach_invites', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='CoachConnection',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('share_measurements', models.BooleanField(default=False)),
                ('share_nutrition', models.BooleanField(default=False)),
                ('coach', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='coached_connections', to=settings.AUTH_USER_MODEL)),
                ('client', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='coach_connection', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='CoachMessage',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('text', models.CharField(max_length=800)),
                ('connection', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='coaching.coachconnection')),
                ('sender', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='coaching_messages', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.CreateModel(
            name='CoachAssignment',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('connection', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assignments', to='coaching.coachconnection')),
                ('routine', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='coaching_assignment', to='training.routine')),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddConstraint(
            model_name='coachconnection',
            constraint=models.CheckConstraint(condition=~models.Q(coach=models.F('client')), name='coach_not_self'),
        ),
        migrations.AddIndex(
            model_name='coachinvitation',
            index=models.Index(fields=['coach', 'expires_at'], name='coach_invite_exp_idx'),
        ),
        migrations.AddIndex(
            model_name='coachmessage',
            index=models.Index(fields=['connection', '-created_at'], name='coach_msg_recent_idx'),
        ),
    ]
