"""Expand exercise search key before Cyrillic reindexing."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('training', '0008_seed_instructions')]

    operations = [
        migrations.AlterField(
            model_name='exercise',
            name='search_name',
            field=models.CharField(max_length=1300, editable=False, db_index=True),
        ),
    ]
