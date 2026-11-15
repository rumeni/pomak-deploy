import json
from decimal import Decimal
from pathlib import Path

from django.db import migrations

from core.text import normalize_search

DATA = Path(__file__).resolve().parent.parent / 'data' / 'usda_foods.json'


def dec(value):
    return None if value is None else Decimal(str(value))


def seed(apps, schema_editor):
    Food = apps.get_model('nutrition', 'Food')
    FoodPortion = apps.get_model('nutrition', 'FoodPortion')
    for item in json.loads(DATA.read_text(encoding='utf-8'))['foods']:
        food, _ = Food.objects.update_or_create(
            slug=item['slug'],
            defaults={
                'source': 'usda',
                'source_ref': str(item['fdc_id']),
                'name': item['name'],
                'name_en': item['name_en'],
                'aliases': item['aliases'],
                'search_name': normalize_search(f"{item['name']} {item['name_en']} {item['aliases']}"),
                'state': item['state'],
                'kcal': dec(item['kcal']),
                'protein_g': dec(item['protein_g']),
                'carbs_g': dec(item['carbs_g']),
                'fat_g': dec(item['fat_g']),
                'fiber_g': dec(item['fiber_g']),
            },
        )
        food.portions.all().delete()
        FoodPortion.objects.bulk_create([
            FoodPortion(food=food, name=p['name'], name_en=p['name_en'], grams=dec(p['grams']), position=i)
            for i, p in enumerate(item['portions'])
        ])


class Migration(migrations.Migration):
    dependencies = [('nutrition', '0001_initial')]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
