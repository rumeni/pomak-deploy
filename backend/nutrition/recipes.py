"""Vrednosti recepta iz sastojaka.

- ukupno = zbir (vrednost sastojka na 100 g × grami / 100)
- na 100 g = ukupno × 100 / masa gotovog jela (ako nije upisana: zbir grama sastojaka)
- ako je neka vrednost nepoznata kod bar jednog sastojka, nepoznata je i u receptu (null, nikad 0)
- porcija "1 porcija" = masa / broj porcija

Recept se čuva kao namirnica, pa se u dnevnik upisuje isto kao namirnica: dnevnik snima
tadašnje vrednosti i kasnija izmena recepta ga ne menja (AC-04).
"""

from decimal import Decimal

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .models import Food, FoodPortion

VALUE_FIELDS = ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')
MACRO_FIELDS = ('protein_g', 'carbs_g', 'fat_g')
# Isti broj decimala kao u Food.
PLACES = {'kcal': Decimal('0.1'), 'protein_g': Decimal('0.01'), 'carbs_g': Decimal('0.01'), 'fat_g': Decimal('0.01'), 'fiber_g': Decimal('0.01')}


def compute(ingredients: list[tuple[Food, Decimal]], mass_g: Decimal | None) -> dict:
    """Vrednosti na 100 g i masa jela. `ingredients` = [(namirnica, grami)]."""
    raw_mass = sum((grams for _, grams in ingredients), Decimal(0))
    mass = mass_g or raw_mass
    values = {}
    for field in VALUE_FIELDS:
        per_food = [getattr(food, field) for food, _ in ingredients]
        if any(v is None for v in per_food):
            values[field] = None
            continue
        total = sum((v * grams / 100 for v, (_, grams) in zip(per_food, ingredients)), Decimal(0))
        values[field] = (total * 100 / mass).quantize(PLACES[field])
    return {'values': values, 'mass_g': mass}


def check_plausible(values: dict) -> None:
    """Premala masa gotovog jela daje nemoguće vrednosti (npr. 150 g masti na 100 g)."""
    macros = sum(values[f] for f in MACRO_FIELDS if values[f] is not None)
    if values['kcal'] > 900 or macros > 100:
        raise serializers.ValidationError({'mass_g': _('The cooked mass is too small for these ingredients.')})


def recompute(recipe: Food) -> None:
    """Ponovo računa vrednosti i porciju recepta (posle izmene recepta ili nekog sastojka)."""
    ingredients = [(i.food, i.grams) for i in recipe.ingredients.select_related('food')]
    result = compute(ingredients, recipe.recipe_mass_g)
    check_plausible(result['values'])
    for field, value in result['values'].items():
        setattr(recipe, field, value)
    recipe.save()
    servings = recipe.recipe_servings or 1
    recipe.portions.all().delete()
    FoodPortion.objects.create(
        food=recipe, position=0, name='1 porcija', name_en='1 serving',
        grams=(result['mass_g'] / servings).quantize(Decimal('0.01')),
    )


def recompute_recipes_using(food: Food) -> None:
    """Izmena lične namirnice menja recepte u kojima je (ali ne i već upisane obroke)."""
    for recipe in Food.objects.filter(ingredients__food=food, archived_at__isnull=True).distinct():
        recompute(recipe)
