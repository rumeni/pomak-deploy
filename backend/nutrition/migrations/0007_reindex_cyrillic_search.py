"""Rebuild persisted search names after adding Serbian Cyrillic transliteration.

No schema changes. Keep old rows searchable during/after a rolling deploy.
"""
from django.db import migrations
from core.text import normalize_search


def reindex(apps, schema_editor):
    db = schema_editor.connection.alias
    for app_label, model_name in (('nutrition', 'Food'), ('training', 'Exercise')):
        Model = apps.get_model(app_label, model_name)
        for row in Model.objects.using(db).all().only('id', 'name', 'name_en', 'aliases').iterator(chunk_size=250):
            key = normalize_search(f'{row.name} {row.name_en} {row.aliases}')
            Model.objects.using(db).filter(pk=row.pk).update(search_name=key)


class Migration(migrations.Migration):
    dependencies = [
        ('nutrition', '0006_nutrition_target'),
        ('training', '0008_seed_instructions'),
    ]

    operations = [migrations.RunPython(reindex, migrations.RunPython.noop)]
