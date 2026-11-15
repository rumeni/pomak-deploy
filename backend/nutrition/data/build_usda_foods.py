"""Pravi usda_foods.json iz zvaničnog USDA FoodData Central SR Legacy CSV skupa.

Upotreba (iz foldera backend):
    python nutrition/data/build_usda_foods.py <folder sa raspakovanim SR Legacy CSV fajlovima>

Skup: https://fdc.nal.usda.gov/download-datasets (SR Legacy, april 2018), javno vlasništvo (CC0).
Nijedna nutritivna vrednost se ne unosi ručno. Ako opis ili porcija iz usda_selection.py ne
postoji tačno, skripta se prekida (bolje greška nego pogrešna namirnica).
"""

import csv
import json
import sys
from pathlib import Path

from usda_selection import CANDIDATES, PORTIONS

# USDA ID-jevi nutrijenata (vrednosti su na 100 g jestivog dela)
NUTRIENTS = {'1008': 'kcal', '1003': 'protein_g', '1005': 'carbs_g', '1004': 'fat_g', '1079': 'fiber_g'}
OUT = Path(__file__).parent / 'usda_foods.json'


def read(folder: Path, name: str):
    with open(folder / name, encoding='utf-8') as f:
        yield from csv.DictReader(f)


def main(folder: Path) -> None:
    by_description = {r['description']: r['fdc_id'] for r in read(folder, 'food.csv')}
    missing = [c[5] for c in CANDIDATES if c[5] not in by_description]
    if missing:
        sys.exit('Nema u USDA skupu:\n' + '\n'.join(missing))

    ids = {by_description[c[5]] for c in CANDIDATES}
    nutrients: dict[str, dict[str, float]] = {}
    for r in read(folder, 'food_nutrient.csv'):
        if r['fdc_id'] in ids and r['nutrient_id'] in NUTRIENTS:
            nutrients.setdefault(r['fdc_id'], {})[NUTRIENTS[r['nutrient_id']]] = float(r['amount'])

    units = {r['id']: r['name'] for r in read(folder, 'measure_unit.csv')}
    portions: dict[str, dict[str, float]] = {}
    for r in read(folder, 'food_portion.csv'):
        if r['fdc_id'] in ids:
            unit = units.get(r['measure_unit_id'], '')
            parts = [r['amount'], '' if unit == 'undetermined' else unit, r['portion_description'], r['modifier']]
            label = ' '.join(p for p in parts if p).replace('1.0 ', '1 ')
            portions.setdefault(r['fdc_id'], {}).setdefault(label, float(r['gram_weight']))

    foods = []
    for slug, name, name_en, aliases, state, description in CANDIDATES:
        fdc_id = by_description[description]
        values = nutrients.get(fdc_id, {})
        if 'kcal' not in values:
            sys.exit(f'{slug}: USDA nema energetsku vrednost')
        food_portions = []
        for label_sr, label_en, usda_label in PORTIONS.get(slug, []):
            grams = portions.get(fdc_id, {}).get(usda_label)
            if grams is None:
                sys.exit(f'{slug}: nema USDA porcije "{usda_label}"; postoje: {list(portions.get(fdc_id, {}))}')
            food_portions.append({'name': label_sr, 'name_en': label_en, 'grams': grams, 'usda_label': usda_label})
        foods.append({
            'slug': slug,
            'fdc_id': int(fdc_id),
            'usda_description': description,
            'name': name,
            'name_en': name_en,
            'aliases': aliases,
            'state': state,
            # Vrednost koje nema u USDA skupu ostaje null ("nepoznato"), nikad 0.
            **{field: values.get(field) for field in NUTRIENTS.values()},
            'portions': food_portions,
        })

    payload = {
        'source': 'USDA FoodData Central, SR Legacy (2018-04)',
        'license': 'CC0 1.0 (public domain)',
        'foods': foods,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(foods)} namirnica -> {OUT.name}')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
