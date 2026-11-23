import re
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from rest_framework.exceptions import APIException

from core.i18n import localized_name
from core.text import FOOD_PREMIGRATION_KEY_LIMIT, search_key_fits

from . import recipes, targets
from .models import Food, FoodPortion, Meal, MealEntry, NutritionDay, NutritionTarget, RecipeIngredient, SavedMeal, SavedMealItem

MAX_PORTIONS = 10
MAX_SHARED_FOODS_PER_24_HOURS = 20
MAX_SAVED_MEAL_ITEMS = 30
MAX_RECIPE_INGREDIENTS = 50
MACRO_FIELDS = ('protein_g', 'carbs_g', 'fat_g')
ENTRY_SNAPSHOT_FIELDS = tuple(f'per100_{field}' for field in MealEntry.VALUE_FIELDS)


class FoodPortionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FoodPortion
        fields = ['name', 'grams']
        extra_kwargs = {'grams': {'min_value': Decimal('0.1'), 'max_value': Decimal('5000')}}

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data['name'] = localized_name(obj)
        return data


BARCODE_RE = re.compile(r'\d{8,14}')


def kcal_from_macros(protein, carbs, fat):
    """Energy from the macros (4 / 4 / 9 kcal per gram), or None if any is unknown."""
    if protein is None or carbs is None or fat is None:
        return None
    return Decimal(4) * protein + Decimal(4) * carbs + Decimal(9) * fat


def kcal_matches(kcal, expected) -> bool:
    """Labels round and count fibre and polyols differently, so allow 20 % or 25 kcal."""
    return abs(Decimal(kcal) - expected) <= max(Decimal(25), expected * Decimal('0.2'))


OFF_SOURCE_RE = re.compile(r'openfoodfacts:\d{8,14}')


def shared_barcode_clash(barcode, exclude_pk=None):
    """The active shared food that already has this barcode, if any."""
    return Food.objects.filter(owner__isnull=True, archived_at__isnull=True, barcode=barcode).exclude(pk=exclude_pk).first()


def barcode_clash_error(clash):
    # Lists, the same shape as errors raised during validation (also when raised from create()).
    return serializers.ValidationError({'barcode': [_(
        'A product with this barcode is already in the database: %(name)s.'
    ) % {'name': localized_name(clash)}], 'existing_id': [str(clash.id)]})


def community_used_by_other(food) -> bool:
    """Other users' recipes AND reusable saved meals must see stable shared-food values.

    Diary entries already snapshot nutrients, but SavedMealItem resolves the food's
    current values every time the user adds that saved meal to the diary.
    """
    return (
        RecipeIngredient.objects.filter(food_id=food.pk)
        .exclude(recipe__owner_id=food.created_by_id).exists()
        or SavedMealItem.objects.filter(food_id=food.pk)
        .exclude(saved_meal__owner_id=food.created_by_id).exists()
    )


def can_edit_food(food, request) -> bool:
    """Own foods; community authors can edit only while unverified and unused by others."""
    user = getattr(request, 'user', None)
    if user is None or not user.is_authenticated:
        return False
    if food.owner_id is not None:
        return food.owner_id == user.pk
    return (food.source == Food.Source.COMMUNITY and food.created_by_id == user.pk
            and food.verified_at is None and not community_used_by_other(food))


class FoodSerializer(serializers.ModelSerializer):
    """Namirnica sa vrednostima na 100 g. Nepoznat makro je null, nikad 0."""

    # TimeStampedModel's UUID is editable=False; make it writable for create
    # retries with a client-assigned ID, but never permit changing an existing PK.
    id = serializers.UUIDField(required=False)
    portions = FoodPortionSerializer(many=True, required=False)
    is_custom = serializers.SerializerMethodField()
    # On create: add it to the shared database (visible to everyone, unverified) instead of
    # keeping it private.
    shared = serializers.BooleanField(write_only=True, required=False, default=False)
    verified = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Food
        fields = [
            'id', 'name', 'aliases', 'source', 'source_ref', 'state', 'kcal',
            'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'portions', 'is_custom',
            'barcode', 'shared', 'verified', 'can_edit',
        ]
        read_only_fields = ['source']
        extra_kwargs = {
            'kcal': {'min_value': 0, 'max_value': 900},
            **{f: {'min_value': 0, 'max_value': 100} for f in (*MACRO_FIELDS, 'fiber_g')},
        }

    def get_is_custom(self, obj) -> bool:
        return obj.owner_id is not None

    def get_verified(self, obj) -> bool:
        # The original library is curated; community foods once an admin checked them.
        return obj.source != Food.Source.COMMUNITY or obj.verified_at is not None

    def get_can_edit(self, obj) -> bool:
        return can_edit_food(obj, self.context.get('request'))

    def validate_barcode(self, value):
        value = value.strip()
        if value and not BARCODE_RE.fullmatch(value):
            raise serializers.ValidationError(_('A barcode has 8 to 14 digits.'))
        return value

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data['name'] = localized_name(obj)
        return data

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Enter the food name.'))
        return value

    def validate_portions(self, value):
        if len(value) > MAX_PORTIONS:
            raise serializers.ValidationError(_('At most %(count)d portions.') % {'count': MAX_PORTIONS})
        return value

    def validate(self, attrs):
        if self.instance is not None and self.instance.source == Food.Source.RECIPE:
            # Vrednosti recepta se računaju iz sastojaka; menja se preko /recipes/.
            raise serializers.ValidationError(_('A recipe is changed through its ingredients.'))
        name = attrs.get('name', getattr(self.instance, 'name', ''))
        aliases = attrs.get('aliases', getattr(self.instance, 'aliases', ''))
        if not search_key_fits(name, getattr(self.instance, 'name_en', ''), aliases, max_chars=FOOD_PREMIGRATION_KEY_LIMIT):
            raise serializers.ValidationError({'name': _('Name or aliases are too long for search.')})
        # Na 100 g namirnice ne može biti više od 100 g proteina, UH i masti zajedno.
        macros = [attrs.get(f, getattr(self.instance, f, None)) for f in MACRO_FIELDS]
        if sum(m for m in macros if m is not None) > 100:
            raise serializers.ValidationError(_('Protein, carbohydrates and fat together cannot exceed 100 g per 100 g.'))
        shared = attrs.get('shared') or (self.instance is not None and self.instance.source == Food.Source.COMMUNITY)
        if shared:
            # Everyone will use these numbers: calories must fit the macros (4/4/9 kcal per g).
            kcal = attrs.get('kcal', getattr(self.instance, 'kcal', None))
            expected = kcal_from_macros(*macros)
            if kcal is not None and expected is not None and not kcal_matches(kcal, expected):
                raise serializers.ValidationError({'kcal': _(
                    'Calories do not match the macros (about %(expected)s kcal expected). Check the values.'
                ) % {'expected': int(expected)}})
            barcode = attrs.get('barcode', getattr(self.instance, 'barcode', ''))
            if barcode:
                clash = shared_barcode_clash(barcode, getattr(self.instance, 'pk', None))
                if clash is not None:
                    raise barcode_clash_error(clash)
            # Open Food Facts data is ODbL; it stays out of the shared library until the team has
            # settled how to meet attribution and share-alike (settings.SHARE_OPEN_FOOD_FACTS_DATA).
            source_ref = attrs.get('source_ref', getattr(self.instance, 'source_ref', ''))
            if source_ref.startswith('openfoodfacts:') and not settings.SHARE_OPEN_FOOD_FACTS_DATA:
                raise serializers.ValidationError({'shared': _(
                    'Values taken from Open Food Facts can be saved as your own food, not shared.'
                )})
        return attrs

    def validate_source_ref(self, value):
        # Only the provenance of Open Food Facts suggestions can be set by the client.
        value = value.strip()
        if value and not OFF_SOURCE_RE.fullmatch(value):
            raise serializers.ValidationError(_('Invalid source.'))
        return value

    @transaction.atomic
    def create(self, validated_data):
        portions = validated_data.pop('portions', [])
        if validated_data.pop('shared', False):
            # Serialize this user's shared creations (including concurrent requests) by locking
            # the user row. Idempotent retries are handled before this serializer is called.
            author = validated_data.pop('owner')
            get_user_model().objects.select_for_update().get(pk=author.pk)
            since = timezone.now() - timedelta(hours=24)
            if Food.objects.filter(source=Food.Source.COMMUNITY, created_by_id=author.pk,
                                   created_at__gte=since).count() >= MAX_SHARED_FOODS_PER_24_HOURS:
                raise serializers.ValidationError({'shared': _('At most 20 shared foods every 24 hours.')})
            validated_data['created_by'] = author
            try:
                with transaction.atomic():
                    food = Food.objects.create(source=Food.Source.COMMUNITY, **validated_data)
            except IntegrityError:
                # Someone added the same product between the check and this insert.
                clash = shared_barcode_clash(validated_data.get('barcode', ''))
                if clash is None:
                    raise
                raise barcode_clash_error(clash) from None
        else:
            food = Food.objects.create(source=Food.Source.CUSTOM, **validated_data)
        self._write_portions(food, portions)
        return food

    @transaction.atomic
    def update(self, food, validated_data):
        validated_data.pop('id', None)  # PATCH and repeated POST cannot change a primary key.
        validated_data.pop('shared', None)  # Sharing is chosen when the food is created.
        validated_data.pop('source_ref', None)  # Provenance is set once, on create.
        portions = validated_data.pop('portions', None)
        food = super().update(food, validated_data)
        if portions is not None:
            food.portions.all().delete()
            self._write_portions(food, portions)
        try:
            recipes.recompute_recipes_using(food)
        except serializers.ValidationError as cause:
            # The problem belongs to this edit, not to a cooked-mass field on
            # the food form. The atomic update restores the previous values.
            raise serializers.ValidationError({
                'non_field_errors': _('This food cannot be changed because a recipe using it would become invalid.'),
            }) from cause
        return food

    def _write_portions(self, food, portions):
        FoodPortion.objects.bulk_create([FoodPortion(food=food, position=i, **p) for i, p in enumerate(portions)])


class MealEntrySerializer(serializers.ModelSerializer):
    """Stavka dnevnika za prikaz (ukupne vrednosti i snimak na 100 g)."""

    food_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = MealEntry
        fields = [
            'id', 'date', 'meal', 'food_id', 'name', 'grams', 'portion_name',
            'per100_kcal', 'per100_protein_g', 'per100_carbs_g', 'per100_fat_g', 'per100_fiber_g',
            'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'created_at',
        ]


class MealEntryWriteSerializer(serializers.Serializer):
    """Upis namirnice, ručne stavke ili kopije sa izvornim nutritivnim snimkom.

    Bez per100_* server uzima trenutnu namirnicu. Kopiranje sa svih pet polja
    ponavlja vrednosti starog unosa bez potrebe da original postoji na serveru.
    """

    date = serializers.DateField()
    meal = serializers.ChoiceField(choices=Meal.choices)
    food_id = serializers.UUIDField(required=False, allow_null=True)
    grams = serializers.DecimalField(max_digits=7, decimal_places=1, min_value=Decimal('0.1'), max_value=Decimal('5000'), required=False, allow_null=True)
    portion_name = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    kcal = serializers.DecimalField(max_digits=7, decimal_places=1, min_value=0, max_value=10000, required=False, allow_null=True)
    protein_g = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=1000, required=False, allow_null=True)
    carbs_g = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=1000, required=False, allow_null=True)
    fat_g = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=1000, required=False, allow_null=True)
    fiber_g = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=1000, required=False, allow_null=True)

    # Optional snapshot: all five keys together, including explicit nulls for
    # unknown macros. Bounds mirror FoodSerializer and recipes.check_plausible.
    per100_kcal = serializers.DecimalField(max_digits=6, decimal_places=1, min_value=0, max_value=900, required=False)
    per100_protein_g = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0, max_value=100, required=False, allow_null=True)
    per100_carbs_g = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0, max_value=100, required=False, allow_null=True)
    per100_fat_g = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0, max_value=100, required=False, allow_null=True)
    per100_fiber_g = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0, max_value=100, required=False, allow_null=True)

    def validate(self, attrs):
        user = self.context['request'].user
        existing = self.context.get('existing')
        supplied = [key for key in ENTRY_SNAPSHOT_FIELDS if key in attrs]
        if supplied:
            if len(supplied) != len(ENTRY_SNAPSHOT_FIELDS):
                raise serializers.ValidationError({
                    'per100_kcal': _('Supply all per-100-g snapshot fields or none.'),
                })
            if not attrs.get('food_id'):
                raise serializers.ValidationError({
                    'food_id': _('A per-100-g snapshot requires a food.'),
                })
            macros = (attrs['per100_protein_g'], attrs['per100_carbs_g'], attrs['per100_fat_g'])
            if sum(value for value in macros if value is not None) > 100:
                raise serializers.ValidationError({
                    'per100_protein_g': _('Protein, carbohydrates and fat together cannot exceed 100 g per 100 g.'),
                })
            # Retried PUTs for the same copy may resend identical snapshot data.
            # Existing entries must never be re-keyed to new per100 values.
            if existing is not None and any(attrs[key] != getattr(existing, key) for key in ENTRY_SNAPSHOT_FIELDS):
                raise serializers.ValidationError({
                    'per100_kcal': _('An existing entry nutritional snapshot cannot be changed.'),
                })
        attrs['has_per100_snapshot'] = bool(supplied)
        # Stavka iz namirnice se prepoznaje po snimku vrednosti (namirnica je mogla biti obrisana).
        from_food = existing is not None and existing.per100_kcal is not None
        food_id = attrs.get('food_id')
        if food_id:
            if existing is not None and existing.food_id != food_id:
                # Snimak vrednosti pripada jednoj namirnici; druga namirnica je nova stavka.
                raise serializers.ValidationError({'food_id': _('The food of an entry cannot be changed.')})
            food = Food.visible_to(user).filter(pk=food_id).first()
            if food is None and existing is None:
                raise serializers.ValidationError({'food_id': _('This food is not available.')})
            attrs['food'] = food
            from_food = True
        elif existing is not None and existing.food_id is not None:
            raise serializers.ValidationError({'food_id': _('The food of an entry cannot be changed.')})
        if from_food:
            if attrs.get('grams') is None:
                raise serializers.ValidationError({'grams': _('Enter the amount in grams.')})
        else:
            if not attrs.get('name', '').strip():
                raise serializers.ValidationError({'name': _('Enter a name.')})
            if attrs.get('kcal') is None:
                raise serializers.ValidationError({'kcal': _('Enter the calories.')})
            attrs['grams'] = None
        attrs['from_food'] = from_food
        return attrs

    def save_entry(self, entry_id, owner):
        data = self.validated_data
        entry = self.context.get('existing')
        if entry is None:
            entry = MealEntry(id=entry_id, owner=owner)
            food = data.get('food')
            if food is not None:
                entry.food = food
                entry.name = localized_name(food)
                for field in MealEntry.VALUE_FIELDS:
                    per100_field = f'per100_{field}'
                    # A copy reuses validated historical values. Ordinary entries
                    # and saved meals use the food's CURRENT snapshot as before.
                    value = data[per100_field] if data['has_per100_snapshot'] else getattr(food, field)
                    setattr(entry, per100_field, value)

        entry.date = data['date']
        entry.meal = data['meal']
        entry.portion_name = data.get('portion_name', '')
        if data['from_food']:
            # Uvek iz snimka iz trenutka unosa, ne iz trenutnih vrednosti namirnice (AC-04).
            entry.grams = data['grams']
            entry.apply_per100()
        else:
            entry.name = data['name'].strip()
            for field in MealEntry.VALUE_FIELDS:
                setattr(entry, field, data.get(field))
        entry.save()
        return entry


class NutritionDaySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=NutritionDay.Status.choices)


class SavedMealItemSerializer(serializers.ModelSerializer):
    food = FoodSerializer(read_only=True)
    food_id = serializers.UUIDField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = SavedMealItem
        fields = ['food', 'food_id', 'grams', 'portion_name', 'name', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']
        extra_kwargs = {
            'grams': {'min_value': Decimal('0.1'), 'max_value': Decimal('5000')},
            'kcal': {'min_value': 0, 'max_value': 10000},
            **{f: {'min_value': 0, 'max_value': 1000} for f in (*MACRO_FIELDS, 'fiber_g')},
        }

    def validate(self, attrs):
        food_id = attrs.pop('food_id', None)
        if food_id:
            food = Food.visible_to(self.context['request'].user).filter(pk=food_id).first()
            if food is None:
                raise serializers.ValidationError({'food_id': _('This food is not available.')})
            if attrs.get('grams') is None:
                raise serializers.ValidationError({'grams': _('Enter the amount in grams.')})
            # Stavka iz namirnice ne čuva vrednosti: uzimaju se od namirnice pri dodavanju u dnevnik.
            return {'food': food, 'grams': attrs['grams'], 'portion_name': attrs.get('portion_name', '')}
        if not attrs.get('name', '').strip() or attrs.get('kcal') is None:
            raise serializers.ValidationError(_('A manual item needs a name and calories.'))
        attrs['grams'] = None
        return attrs


class SavedMealSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    items = SavedMealItemSerializer(many=True)

    class Meta:
        model = SavedMeal
        fields = ['id', 'name', 'items', 'created_at']
        read_only_fields = ['created_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Enter a name.'))
        return value

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError(_('A saved meal needs at least one item.'))
        if len(value) > MAX_SAVED_MEAL_ITEMS:
            raise serializers.ValidationError(_('At most %(count)d items.') % {'count': MAX_SAVED_MEAL_ITEMS})
        return value

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop('items')

        # Validation above is deliberately outside this transaction in DRF and may
        # have read a stale Food row. Lock ALL referenced foods in deterministic
        # UUID order, just as an author update/archive locks the Food row, then
        # recheck availability UNDER that lock before inserting SavedMealItems.
        # A save that wins the lock freezes future author changes; if the author
        # wins first, the save sees updated active values or rejects an archive.
        # Lock plain foods BEFORE recipe foods. Food corrections take an ingredient
        # lock and then its dependent recipe lock, and recipe edits do the same.
        # A single UUID order across both types could instead lock the recipe
        # first and deadlock with a concurrent recipe edit.
        foods = {item['food'].pk: item['food'] for item in items if item.get('food')}
        active = {}
        for is_recipe in (False, True):
            ids = sorted(
                (pk for pk, food in foods.items() if (food.source == Food.Source.RECIPE) == is_recipe),
                key=str,
            )
            if not ids:
                continue
            locked = {
                food.pk: food for food in
                Food.visible_to(self.context['request'].user)
                .filter(pk__in=ids, archived_at__isnull=True)
                .order_by('pk').select_for_update()
            }
            if len(locked) != len(ids):
                raise serializers.ValidationError({'items': _('This food is not available.')})
            active.update(locked)
        for item in items:
            if item.get('food'):
                item['food'] = active[item['food'].pk]

        meal = SavedMeal.objects.create(**validated_data)
        SavedMealItem.objects.bulk_create([SavedMealItem(saved_meal=meal, position=i, **item) for i, item in enumerate(items)])
        return meal


class RecipeIngredientSerializer(serializers.ModelSerializer):
    food = FoodSerializer(read_only=True)
    food_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = RecipeIngredient
        fields = ['food', 'food_id', 'grams', 'portion_name']
        extra_kwargs = {'grams': {'min_value': Decimal('0.1'), 'max_value': Decimal('5000')}}

    def validate(self, attrs):
        # Legacy APKs send every ingredient on PUT, even when changing only
        # recipe metadata. Defer archived-food checks for updates until the
        # parent compares the full list under its recipe lock.
        foods = Food.visible_to(self.context['request'].user).filter(pk=attrs.pop('food_id'))
        if self.root.instance is None:
            foods = foods.filter(archived_at__isnull=True)
        food = foods.first()
        if food is None:
            raise serializers.ValidationError({'food_id': _('This food is not available.')})
        if food.source == Food.Source.RECIPE:
            raise serializers.ValidationError({'food_id': _('A recipe cannot contain another recipe.')})
        attrs['food'] = food
        return attrs


class RecipeSerializer(serializers.ModelSerializer):
    """Recept: sastojci, masa gotovog jela (opciono) i broj porcija. Vrednosti na 100 g i
    porcija "1 porcija" se računaju na serveru (nutrition.recipes)."""

    id = serializers.UUIDField(required=False)
    mass_g = serializers.DecimalField(
        source='recipe_mass_g', max_digits=7, decimal_places=1, min_value=Decimal('1'), max_value=Decimal('50000'),
        required=False, allow_null=True,
    )
    servings = serializers.IntegerField(source='recipe_servings', min_value=1, max_value=100, required=False, default=1)
    ingredients = RecipeIngredientSerializer(many=True)
    portions = FoodPortionSerializer(many=True, read_only=True)
    raw_mass_g = serializers.SerializerMethodField()

    class Meta:
        model = Food
        fields = [
            'id', 'name', 'mass_g', 'servings', 'ingredients', 'raw_mass_g',
            'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'portions', 'created_at',
        ]
        read_only_fields = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'created_at']

    def get_raw_mass_g(self, obj) -> str:
        return str(sum((i.grams for i in obj.ingredients.all()), Decimal(0)))

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Enter a name.'))
        return value

    def validate_ingredients(self, value):
        if not value:
            raise serializers.ValidationError(_('A recipe needs at least one ingredient.'))
        if len(value) > MAX_RECIPE_INGREDIENTS:
            raise serializers.ValidationError(_('At most %(count)d ingredients.') % {'count': MAX_RECIPE_INGREDIENTS})
        return value

    def validate(self, attrs):
        name = attrs.get('name', getattr(self.instance, 'name', ''))
        if not search_key_fits(name, getattr(self.instance, 'name_en', ''),
                               getattr(self.instance, 'aliases', ''), max_chars=FOOD_PREMIGRATION_KEY_LIMIT):
            raise serializers.ValidationError({'name': _('Name is too long for search.')})
        ingredients = attrs.get('ingredients')
        if ingredients is None:
            ingredients = [{'food': i.food, 'grams': i.grams} for i in self.instance.ingredients.select_related('food')]
        mass = attrs['recipe_mass_g'] if 'recipe_mass_g' in attrs else getattr(self.instance, 'recipe_mass_g', None)
        result = recipes.compute([(i['food'], i['grams']) for i in ingredients], mass)
        recipes.check_plausible(result['values'])
        return attrs

    def _locked_ingredients(self, ingredients, *, allow_archived=False):
        """Re-read ingredients under row locks before computing or linking a recipe.

        Food edits/archive take the Food lock before recalculating dependent recipes.
        Using the same order here prevents a recipe from capturing stale nutrition or
        being linked to a food archived while its request was being validated.
        """
        ids = sorted({item['food'].pk for item in ingredients}, key=str)
        visible = Food.visible_to(self.context['request'].user).filter(pk__in=ids)
        if not allow_archived:
            visible = visible.filter(archived_at__isnull=True)
        foods = {food.pk: food for food in visible.order_by('pk').select_for_update()}
        if len(foods) != len(ids):
            raise serializers.ValidationError({'ingredients': _('This food is not available.')})
        if any(food.source == Food.Source.RECIPE for food in foods.values()):
            raise serializers.ValidationError({'ingredients': _('A recipe cannot contain another recipe.')})
        return [{**item, 'food': foods[item['food'].pk]} for item in ingredients]

    @staticmethod
    def _check_locked_values(ingredients, mass):
        values = recipes.compute([(item['food'], item['grams']) for item in ingredients], mass)
        recipes.check_plausible(values['values'])

    @transaction.atomic
    def create(self, validated_data):
        ingredients = self._locked_ingredients(validated_data.pop('ingredients'))
        self._check_locked_values(ingredients, validated_data.get('recipe_mass_g'))
        recipe = Food.objects.create(source=Food.Source.RECIPE, state=Food.State.PREPARED, kcal=0, **validated_data)
        self._write_ingredients(recipe, ingredients)
        recipes.recompute(recipe)
        return recipe

    @transaction.atomic
    def update(self, recipe, validated_data):
        # The URL selects the owned recipe. Never permit a body-supplied UUID
        # to re-key it onto a shared or another user's Food record.
        validated_data.pop('id', None)
        ingredients = validated_data.pop('ingredients', None)
        # Metadata-only PATCH or legacy PUT with an identical historical
        # ingredient list may preserve archived rows. Changes to the list may not.
        previous = None
        if ingredients is None:
            previous = list(RecipeIngredient.objects.filter(recipe=recipe).select_related('food').order_by('position'))
            ingredients_to_check = [
                {'food': item.food, 'grams': item.grams, 'portion_name': item.portion_name}
                for item in previous
            ]
        else:
            ingredients_to_check = ingredients
        fresh = self._locked_ingredients(ingredients_to_check, allow_archived=True)
        # Lock the recipe only AFTER ingredient foods (same order as Food edits).
        recipe = Food.objects.select_for_update().get(pk=recipe.pk)
        if recipe.archived_at is not None or recipe.owner_id != self.context['request'].user.pk:
            raise serializers.ValidationError({'id': _('This recipe is no longer available.')})
        has_archived = any(item['food'].archived_at is not None for item in fresh)
        if previous is not None or has_archived:
            # Read CURRENT ingredient rows only after locking their recipe:
            # another request may have replaced the list since validation.
            current = list(RecipeIngredient.objects.filter(recipe=recipe).order_by('position'))
            stored = [(i.food_id, i.grams, i.portion_name.strip()) for i in current]
            if previous is not None:
                snapshot = [(i.food_id, i.grams, i.portion_name.strip()) for i in previous]
                if stored != snapshot:
                    raise serializers.ValidationError({'ingredients': _('This recipe changed. Reload and try again.')})
            if has_archived:
                submitted = [(i['food'].pk, i['grams'], i.get('portion_name', '').strip()) for i in fresh]
                if submitted != stored:
                    raise serializers.ValidationError({'ingredients': _('This food is not available.')})
                # An identical legacy PUT is metadata-only. Preserve historical
                # rows instead of deleting and recreating archived references.
                ingredients = None
        self._check_locked_values(fresh, validated_data.get('recipe_mass_g', recipe.recipe_mass_g))
        recipe = super().update(recipe, validated_data)
        if ingredients is not None:
            recipe.ingredients.all().delete()
            self._write_ingredients(recipe, fresh)
        recipes.recompute(recipe)
        return recipe

    def _write_ingredients(self, recipe, ingredients):
        RecipeIngredient.objects.bulk_create([RecipeIngredient(recipe=recipe, position=i, **x) for i, x in enumerate(ingredients)])


class NutritionTargetSerializer(serializers.ModelSerializer):
    # "Do cilja koji je postavio trener …": the coach's name, only for a target the coach set.
    set_by_name = serializers.SerializerMethodField()

    class Meta:
        model = NutritionTarget
        fields = ['valid_from', 'mode', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'method', 'inputs', 'explanation', 'created_at',
                  'set_by_name']

    def get_set_by_name(self, obj) -> str | None:
        if obj.mode != NutritionTarget.Mode.COACH or obj.set_by is None:
            return None
        return obj.set_by.profile.display_name.strip() or obj.set_by.email.split('@')[0]


class EstimateSerializer(serializers.Serializer):
    """Izbori korisnika za procenu; telesni podaci se uzimaju iz profila i poslednjeg merenja težine."""

    activity = serializers.ChoiceField(choices=list(targets.ACTIVITY_FACTORS))
    # The four goals; older apps still send lose / maintain / gain (taken as the new ones).
    goal = serializers.ChoiceField(choices=[*targets.GOALS, *targets.LEGACY_GOALS])
    pace = serializers.FloatField(default=0)
    # Trudnoća, dojenje, poremećaj ishrane ili bolest zbog koje ishranu vodi lekar.
    special_conditions = serializers.BooleanField()

    def validate(self, attrs):
        # Legacy values stay as sent (they keep the earlier method); the pace rule is the same.
        # Recomposition and maintenance have no pace: only 0 is accepted.
        if attrs['pace'] not in targets.PACES[targets.normalize_goal(attrs['goal'])]:
            raise serializers.ValidationError({'pace': _('Choose one of the offered paces.')})
        return attrs

    def estimate(self, user, valid_from):
        """Rezultat metoda, ili {'supported': False, 'reason': ...} za nepodržan profil (AC-06)."""
        from progress.models import Measurement

        data = self.validated_data
        if data['special_conditions']:
            return {'supported': False, 'reason': 'special_conditions'}
        profile = user.profile
        weight = Measurement.objects.filter(user=user, kind=Measurement.Kind.WEIGHT).order_by('-measured_on', '-created_at').first()
        missing = [
            name for name, value in [
                ('sex', profile.sex), ('birth_date', profile.birth_date), ('height', profile.height_cm), ('weight', weight),
            ] if not value
        ]
        if missing:
            return {'supported': False, 'reason': 'missing', 'missing': missing}
        return targets.estimate(targets.Inputs(
            sex=profile.sex, birth_date=profile.birth_date, height_cm=float(profile.height_cm),
            weight_kg=float(weight.value), weight_date=weight.measured_on,
            activity=data['activity'], goal=data['goal'], pace=data['pace'], valid_from=valid_from,
        ))


class EstimateChanged(APIException):
    status_code = 409

    def __init__(self, estimate):
        super().__init__({'code': 'estimate_changed', 'detail': _('The proposal has changed. Check the new one.')})
        self.detail['estimate'] = estimate


class ExpectedEstimateSerializer(serializers.Serializer):
    """The displayed method and all four values, not a client-supplied prescription."""

    method = serializers.CharField(max_length=40)
    kcal = serializers.IntegerField()
    protein_g = serializers.IntegerField()
    carbs_g = serializers.IntegerField()
    fat_g = serializers.IntegerField()


class TargetWriteSerializer(EstimateSerializer):
    """Novi cilj: procena aplikacije (server računa ponovo, ne veruje poslatim brojevima) ili moj cilj."""

    mode = serializers.ChoiceField(choices=[NutritionTarget.Mode.APP, NutritionTarget.Mode.MANUAL])
    activity = serializers.ChoiceField(choices=list(targets.ACTIVITY_FACTORS), required=False)
    goal = serializers.ChoiceField(choices=[*targets.GOALS, *targets.LEGACY_GOALS], required=False)
    special_conditions = serializers.BooleanField(required=False, default=False)
    kcal = serializers.IntegerField(min_value=800, max_value=8000, required=False)
    protein_g = serializers.IntegerField(min_value=0, max_value=600, required=False, allow_null=True)
    carbs_g = serializers.IntegerField(min_value=0, max_value=1500, required=False, allow_null=True)
    fat_g = serializers.IntegerField(min_value=0, max_value=500, required=False, allow_null=True)
    # The proposal the user saw and accepted (the app): saved only if it is still the same.
    expected = ExpectedEstimateSerializer(required=False)

    def validate(self, attrs):
        if attrs['mode'] == NutritionTarget.Mode.MANUAL:
            if attrs.get('kcal') is None:
                raise serializers.ValidationError({'kcal': _('Enter the calories.')})
            macro_kcal = 4 * (attrs.get('protein_g') or 0) + 4 * (attrs.get('carbs_g') or 0) + 9 * (attrs.get('fat_g') or 0)
            if macro_kcal > attrs['kcal'] * 1.1:
                raise serializers.ValidationError(_('The macros add up to more calories than the target.'))
            return attrs
        if 'activity' not in attrs or 'goal' not in attrs:
            raise serializers.ValidationError(_('Choose the activity level and goal.'))
        if attrs['goal'] not in targets.LEGACY_GOALS and 'expected' not in attrs:
            raise serializers.ValidationError({'expected': 'Review the proposal before accepting it.'})
        return super().validate(attrs)

    def save_target(self, user, valid_from):
        data = self.validated_data
        values = {'mode': data['mode'], 'set_by': user, 'method': '', 'inputs': None, 'explanation': None}
        if data['mode'] == NutritionTarget.Mode.MANUAL:
            values.update({f: data.get(f) for f in ('kcal', 'protein_g', 'carbs_g', 'fat_g')})
        else:
            result = self.estimate(user, valid_from)
            seen = data.get('expected')
            if not result['supported']:
                if seen is not None:
                    raise EstimateChanged(result)
                raise serializers.ValidationError({'reason': result['reason']})
            if seen is not None and any(seen[f] != result[f] for f in ('method', 'kcal', 'protein_g', 'carbs_g', 'fat_g')):
                # Something changed since the proposal was shown (e.g. a new weight): never save
                # other numbers than the ones accepted; the app shows the new proposal.
                raise EstimateChanged(result)
            values.update({f: result[f] for f in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'method', 'inputs', 'explanation')})
        target, _created = NutritionTarget.objects.update_or_create(owner=user, valid_from=valid_from, defaults=values)
        return target
