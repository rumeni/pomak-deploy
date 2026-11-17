"""Open Food Facts: free, open product database (https://world.openfoodfacts.org).

Used only to suggest values for a scanned barcode the app does not know yet. Nothing about
the user is sent - just the barcode. The athlete confirms (and may correct) the values before
the food is saved.
"""

import json
import logging
from decimal import Decimal, InvalidOperation
from urllib.error import URLError
from urllib.request import Request, urlopen

log = logging.getLogger(__name__)

URL = 'https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=product_name,product_name_sr,brands,nutriments'
# The public API is often slow (5-8 s); the app shows "looking up" meanwhile.
TIMEOUT = 9
USER_AGENT = 'POMAK/1.0 (fitness diary app)'
KJ_PER_KCAL = Decimal('4.184')


def _number(nutriments: dict, key: str) -> Decimal | None:
    value = nutriments.get(key)
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return number if number >= 0 else None


def _fetch(code: str) -> dict | None:
    try:
        with urlopen(Request(URL.format(code=code), headers={'User-Agent': USER_AGENT}), timeout=TIMEOUT) as res:
            return json.load(res)
    except (URLError, TimeoutError, ValueError, OSError) as error:
        log.info('Open Food Facts lookup failed for %s: %s', code, error)
        return None


def suggestion_from(code: str, data: dict | None) -> dict | None:
    """Values per 100 g from an Open Food Facts response, or None if there is nothing usable."""
    if not data or data.get('status') != 1:
        return None
    product = data.get('product') or {}
    n = product.get('nutriments') or {}
    kcal = _number(n, 'energy-kcal_100g')
    if kcal is None:
        kj = _number(n, 'energy-kj_100g') or _number(n, 'energy_100g')
        kcal = (kj / KJ_PER_KCAL) if kj is not None else None
    if kcal is None or kcal > 900:
        return None
    name = (product.get('product_name_sr') or product.get('product_name') or '').strip()
    brand = (product.get('brands') or '').split(',')[0].strip()
    if brand and brand.lower() not in name.lower():
        name = f'{name} ({brand})' if name else brand

    def per100(key):
        value = _number(n, key)
        return str(value.quantize(Decimal('0.1'))) if value is not None and value <= 100 else None

    return {
        'name': name[:150],
        'barcode': code,
        'kcal': str(kcal.quantize(Decimal('1'))),
        'protein_g': per100('proteins_100g'),
        'carbs_g': per100('carbohydrates_100g'),
        'fat_g': per100('fat_100g'),
        'fiber_g': per100('fiber_100g'),
        'source': 'open_food_facts',
    }


def lookup(code: str) -> dict | None:
    return suggestion_from(code, _fetch(code))
