from decimal import Decimal

from django.db import transaction
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from core.i18n import localized_name

from . import recipes, targets
from .models import Food, FoodPortion, Meal, MealEntry, NutritionDay, NutritionTarget, RecipeIngredient, SavedMeal, SavedMealItem

MAX_PORTIONS = 10
MAX_SAVED_MEAL_ITEMS = 30
MAX_RECIPE_INGREDIENTS = 50
MACRO_FIELDS = ('protein_g', 'carbs_g', 'fat_g')


class FoodPortionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FoodPortion
        fields = ['name', 'grams']
        extra_kwargs = {'grams': {'min_value': Decimal('0.1'), 'max_value': Decimal('5000')}}

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data['name'] = localized_name(obj)
        return data


class FoodSerializer(serializers.ModelSerializer):
    """Namirnica sa vrednostima na 100 g. Nepoznat makro je null, nikad 0."""

    portions = FoodPortionSerializer(many=True, required=False)
    is_custom = serializers.SerializerMethodField()

    class Meta:
        model = Food
        fields = [
            'id', 'name', 'aliases', 'source', 'source_ref', 'state', 'kcal',
            'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'portions', 'is_custom',
        ]
        read_only_fields = ['source', 'source_ref']
        extra_kwargs = {
            'kcal': {'min_value': 0, 'max_value': 900},
            **{f: {'min_value': 0, 'max_value': 100} for f in (*MACRO_FIELDS, 'fiber_g')},
        }

    def get_is_custom(self, obj) -> bool:
        return obj.owner_id is not None

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
        # Na 100 g namirnice ne može biti više od 100 g proteina, UH i masti zajedno.
        macros = [attrs.get(f, getattr(self.instance, f, None)) for f in MACRO_FIELDS]
        if sum(m for m in macros if m is not None) > 100:
            raise serializers.ValidationError(_('Protein, carbohydrates and fat together cannot exceed 100 g per 100 g.'))
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        portions = validated_data.pop('portions', [])
        food = Food.objects.create(source=Food.Source.CUSTOM, **validated_data)
        self._write_portions(food, portions)
        return food

    @transaction.atomic
    def update(self, food, validated_data):
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
    """Upis stavke: iz namirnice (food_id + grams) ili ručno (name + kcal, makroi opcioni)."""

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

    def validate(self, attrs):
        user = self.context['request'].user
        existing = self.context.get('existing')
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
                    setattr(entry, f'per100_{field}', getattr(food, field))

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
        food = Food.visible_to(self.context['request'].user).filter(pk=attrs.pop('food_id')).first()
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
        ingredients = attrs.get('ingredients')
        if ingredients is None:
            ingredients = [{'food': i.food, 'grams': i.grams} for i in self.instance.ingredients.select_related('food')]
        mass = attrs['recipe_mass_g'] if 'recipe_mass_g' in attrs else getattr(self.instance, 'recipe_mass_g', None)
        result = recipes.compute([(i['food'], i['grams']) for i in ingredients], mass)
        recipes.check_plausible(result['values'])
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        ingredients = validated_data.pop('ingredients')
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
        recipe = super().update(recipe, validated_data)
        if ingredients is not None:
            recipe.ingredients.all().delete()
            self._write_ingredients(recipe, ingredients)
        recipes.recompute(recipe)
        return recipe

    def _write_ingredients(self, recipe, ingredients):
        RecipeIngredient.objects.bulk_create([RecipeIngredient(recipe=recipe, position=i, **x) for i, x in enumerate(ingredients)])


class NutritionTargetSerializer(serializers.ModelSerializer):
    class Meta:
        model = NutritionTarget
        fields = ['valid_from', 'mode', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'method', 'inputs', 'explanation', 'created_at']


class EstimateSerializer(serializers.Serializer):
    """Izbori korisnika za procenu; telesni podaci se uzimaju iz profila i poslednjeg merenja težine."""

    activity = serializers.ChoiceField(choices=list(targets.ACTIVITY_FACTORS))
    goal = serializers.ChoiceField(choices=list(targets.PACES))
    pace = serializers.FloatField(default=0)
    # Trudnoća, dojenje, poremećaj ishrane ili bolest zbog koje ishranu vodi lekar.
    special_conditions = serializers.BooleanField()

    def validate(self, attrs):
        if attrs['pace'] not in targets.PACES[attrs['goal']]:
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


class TargetWriteSerializer(EstimateSerializer):
    """Novi cilj: procena aplikacije (server računa ponovo, ne veruje poslatim brojevima) ili moj cilj."""

    mode = serializers.ChoiceField(choices=[NutritionTarget.Mode.APP, NutritionTarget.Mode.MANUAL])
    activity = serializers.ChoiceField(choices=list(targets.ACTIVITY_FACTORS), required=False)
    goal = serializers.ChoiceField(choices=list(targets.PACES), required=False)
    special_conditions = serializers.BooleanField(required=False, default=False)
    kcal = serializers.IntegerField(min_value=800, max_value=8000, required=False)
    protein_g = serializers.IntegerField(min_value=0, max_value=600, required=False, allow_null=True)
    carbs_g = serializers.IntegerField(min_value=0, max_value=1500, required=False, allow_null=True)
    fat_g = serializers.IntegerField(min_value=0, max_value=500, required=False, allow_null=True)

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
        return super().validate(attrs)

    def save_target(self, user, valid_from):
        data = self.validated_data
        values = {'mode': data['mode'], 'set_by': user, 'method': '', 'inputs': None, 'explanation': None}
        if data['mode'] == NutritionTarget.Mode.MANUAL:
            values.update({f: data.get(f) for f in ('kcal', 'protein_g', 'carbs_g', 'fat_g')})
        else:
            result = self.estimate(user, valid_from)
            if not result['supported']:
                raise serializers.ValidationError({'reason': result['reason']})
            values.update({f: result[f] for f in ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'method', 'inputs', 'explanation')})
        target, _created = NutritionTarget.objects.update_or_create(owner=user, valid_from=valid_from, defaults=values)
        return target
