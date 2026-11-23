"""Adds the USDA foods added to usda_foods.json after 0002 (Celina 4: more common foods).

0002 seeds the whole file on a new database; on an existing one it already ran, so this adds only
the foods whose slug is missing. Existing foods (and anything an admin changed) are never touched.
"""

import json
from decimal import Decimal
from pathlib import Path

from django.db import migrations

from core.text import normalize_search

DATA = Path(__file__).resolve().parent.parent / 'data' / 'usda_foods.json'


def dec(value):
    return None if value is None else Decimal(str(value))


def add_missing(apps, schema_editor):
    Food = apps.get_model('nutrition', 'Food')
    FoodPortion = apps.get_model('nutrition', 'FoodPortion')
    existing = set(Food.objects.filter(slug__isnull=False).values_list('slug', flat=True))
    for item in json.loads(DATA.read_text(encoding='utf-8'))['foods']:
        if item['slug'] in existing:
            continue
        food = Food.objects.create(
            slug=item['slug'], source='usda', source_ref=str(item['fdc_id']),
            name=item['name'], name_en=item['name_en'], aliases=item['aliases'],
            search_name=normalize_search(f"{item['name']} {item['name_en']} {item['aliases']}"),
            state=item['state'], kcal=dec(item['kcal']), protein_g=dec(item['protein_g']),
            carbs_g=dec(item['carbs_g']), fat_g=dec(item['fat_g']), fiber_g=dec(item['fiber_g']),
        )
        FoodPortion.objects.bulk_create([
            FoodPortion(food=food, name=p['name'], name_en=p['name_en'], grams=dec(p['grams']), position=i)
            for i, p in enumerate(item['portions'])
        ])


class Migration(migrations.Migration):
    dependencies = [('nutrition', '0009_unique_open_food_report')]

    operations = [migrations.RunPython(add_missing, migrations.RunPython.noop)]
