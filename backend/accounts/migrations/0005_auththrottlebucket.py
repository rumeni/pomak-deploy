from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0004_profile_meals')]

    operations = [
        migrations.CreateModel(
            name='AuthThrottleBucket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.CharField(max_length=64)),
                ('window_start', models.DateTimeField()),
                ('attempts', models.PositiveIntegerField(default=0)),
            ],
        ),
        migrations.AddConstraint(
            model_name='auththrottlebucket',
            constraint=models.UniqueConstraint(fields=('key', 'window_start'), name='auth_throttle_bucket_key_window'),
        ),
    ]
