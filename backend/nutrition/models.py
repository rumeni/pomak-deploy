from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from core.models import TimeStampedModel
from core.text import normalize_search


class Food(TimeStampedModel):
    """Namirnica sa vrednostima na 100 g. Zajednička (owner=None, npr. iz USDA) ili lična.

    Makroi i vlakna mogu biti nepoznati (null); nepoznato se nikad ne prikazuje ni računa kao 0.
    """

    class Source(models.TextChoices):
        USDA = 'usda', 'USDA FoodData Central'
        CUSTOM = 'custom', _('Custom')
        # Recept: vrednosti na 100 g se računaju iz sastojaka i mase gotovog jela (nutrition.recipes).
        RECIPE = 'recipe', _('Recipe')
        # Added by a user for everyone (usually a packaged product); "unverified" until an
        # admin checks it (verified_at).
        COMMUNITY = 'community', _('Community')

    class State(models.TextChoices):
        RAW = 'raw', _('Raw')
        COOKED = 'cooked', _('Cooked')
        PREPARED = 'prepared', _('Prepared')
        NA = 'na', _('Not applicable')

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name='custom_foods',
    )
    source = models.CharField(max_length=20, choices=Source.choices)
    # ID u izvoru (npr. USDA FDC ID), da svaka vrednost može da se proveri.
    source_ref = models.CharField(max_length=40, blank=True)
    slug = models.SlugField(max_length=80, unique=True, null=True, blank=True)
    name = models.CharField(max_length=150)
    name_en = models.CharField(max_length=150, blank=True)
    aliases = models.CharField(max_length=300, blank=True)
    search_name = models.CharField(max_length=1300, editable=False, db_index=True)
    state = models.CharField(max_length=10, choices=State.choices, default=State.NA)

    kcal = models.DecimalField(max_digits=6, decimal_places=1)
    protein_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    carbs_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    fat_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    fiber_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    # Samo za recept: masa gotovog jela (null = zbir sastojaka) i broj porcija.
    recipe_mass_g = models.DecimalField(max_digits=7, decimal_places=1, null=True, blank=True)
    recipe_servings = models.PositiveSmallIntegerField(null=True, blank=True)

    # Namirnica se ne briše: dnevnik čuva svoj snimak vrednosti, ali veza ostaje čitljiva.
    archived_at = models.DateTimeField(null=True, blank=True)

    # EAN/UPC from the package, so a product is entered once and found by scanning.
    barcode = models.CharField(max_length=32, blank=True, db_index=True)
    # Who added a community food (never shown to other users; nulled if the account goes).
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['search_name']
        constraints = [
            # One active shared entry per product barcode; an archived one keeps its history but
            # no longer reserves the barcode, so the product can be added again.
            models.UniqueConstraint(
                fields=['barcode'], condition=Q(owner__isnull=True) & Q(archived_at__isnull=True) & ~Q(barcode=''),
                name='unique_active_shared_food_barcode',
            ),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.search_name = normalize_search(f'{self.name} {self.name_en} {self.aliases}')
        super().save(*args, **kwargs)

    @classmethod
    def visible_to(cls, user):
        return cls.objects.filter(Q(owner__isnull=True) | Q(owner=user))


class FoodPortion(TimeStampedModel):
    """Uobičajena količina ("1 jaje", "1 kašika") izražena u gramima."""

    food = models.ForeignKey(Food, on_delete=models.CASCADE, related_name='portions')
    name = models.CharField(max_length=80)
    name_en = models.CharField(max_length=80, blank=True)
    grams = models.DecimalField(max_digits=7, decimal_places=2)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['position']


class RecipeIngredient(TimeStampedModel):
    """Sastojak recepta: namirnica i količina (sirova, kako ulazi u jelo)."""

    recipe = models.ForeignKey(Food, on_delete=models.CASCADE, related_name='ingredients')
    food = models.ForeignKey(Food, on_delete=models.RESTRICT, related_name='used_in')
    position = models.PositiveSmallIntegerField()
    grams = models.DecimalField(max_digits=7, decimal_places=1)
    portion_name = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ['position']


class Meal(models.TextChoices):
    """Mesta za obroke. Korisnik bira koja koristi i kako se zovu (Profile.meals)."""

    BREAKFAST = 'breakfast', _('Breakfast')
    LUNCH = 'lunch', _('Lunch')
    DINNER = 'dinner', _('Dinner')
    SNACK = 'snack', _('Snack')
    MEAL5 = 'meal5', _('Meal 5')
    MEAL6 = 'meal6', _('Meal 6')


class MealEntry(TimeStampedModel):
    """Stavka dnevnika. Čuva SNIMAK vrednosti iz trenutka unosa: kasnija izmena namirnice
    ne menja već upisan obrok (AC-04).

    - iz namirnice: `per100_*` = vrednosti namirnice na 100 g u trenutku unosa; ukupno = per100 × grami
    - ručni unos: nema namirnice ni grama; upisane su ukupne vrednosti
    Nepoznata vrednost je null i ne sabira se kao 0.
    """

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='meal_entries')
    date = models.DateField()
    meal = models.CharField(max_length=20, choices=Meal.choices)
    food = models.ForeignKey(Food, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    name = models.CharField(max_length=150)
    grams = models.DecimalField(max_digits=7, decimal_places=1, null=True, blank=True)
    portion_name = models.CharField(max_length=80, blank=True)

    per100_kcal = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    per100_protein_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    per100_carbs_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    per100_fat_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    per100_fiber_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    kcal = models.DecimalField(max_digits=7, decimal_places=1)
    protein_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    carbs_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    fat_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    fiber_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ['created_at']
        indexes = [models.Index(fields=['owner', 'date'])]

    VALUE_FIELDS = ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')

    def apply_per100(self):
        """Ukupne vrednosti iz snimka na 100 g i količine."""
        for field in self.VALUE_FIELDS:
            per100 = getattr(self, f'per100_{field}')
            setattr(self, field, None if per100 is None else (per100 * self.grams / 100).quantize(per100))


class NutritionDay(TimeStampedModel):
    """Status dana. Dan je "kompletan" samo kad ga korisnik tako označi."""

    class Status(models.TextChoices):
        IN_PROGRESS = 'in_progress', _('In progress')
        COMPLETE = 'complete', _('Complete')
        INCOMPLETE = 'incomplete', _('Incomplete')

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='nutrition_days')
    date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'date'], name='one_nutrition_day_per_date')]


class SavedMeal(TimeStampedModel):
    """Obrok koji se često ponavlja; dodaje se u dnevnik odjednom.

    Stavka iz namirnice čuva samo namirnicu i količinu: pri dodavanju u dnevnik uzimaju se
    tadašnje vrednosti namirnice (i one se tada snime u dnevnik). Ručna stavka čuva vrednosti.
    """

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='saved_meals')
    name = models.CharField(max_length=100)

    class Meta:
        ordering = ['name']


class SavedMealItem(TimeStampedModel):
    saved_meal = models.ForeignKey(SavedMeal, on_delete=models.CASCADE, related_name='items')
    position = models.PositiveSmallIntegerField()
    food = models.ForeignKey(Food, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    grams = models.DecimalField(max_digits=7, decimal_places=1, null=True, blank=True)
    portion_name = models.CharField(max_length=80, blank=True)
    # Ručna stavka (bez namirnice)
    name = models.CharField(max_length=150, blank=True)
    kcal = models.DecimalField(max_digits=7, decimal_places=1, null=True, blank=True)
    protein_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    carbs_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    fat_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    fiber_g = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ['position']


class NutritionTarget(TimeStampedModel):
    """Dnevni kalorijski cilj koji važi od `valid_from` do sledećeg cilja.

    Jedan cilj po datumu (AC-07): za dan D važi cilj sa najkasnijim valid_from <= D, pa promena
    cilja ne menja ranije dane. Uz cilj iz aplikacije čuvaju se ulazi, verzija metoda i
    objašnjenje proračuna (AC-06).
    """

    class Mode(models.TextChoices):
        APP = 'app', _('App estimate')
        MANUAL = 'manual', _('My target')
        COACH = 'coach', _('Set by coach')

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='nutrition_targets')
    valid_from = models.DateField()
    mode = models.CharField(max_length=10, choices=Mode.choices)
    kcal = models.PositiveIntegerField()
    protein_g = models.PositiveSmallIntegerField(null=True, blank=True)
    carbs_g = models.PositiveSmallIntegerField(null=True, blank=True)
    fat_g = models.PositiveSmallIntegerField(null=True, blank=True)
    method = models.CharField(max_length=20, blank=True)
    inputs = models.JSONField(null=True, blank=True)
    explanation = models.JSONField(null=True, blank=True)
    # Ko je postavio cilj (korisnik ili, kasnije, trener).
    set_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        ordering = ['-valid_from']
        constraints = [models.UniqueConstraint(fields=['owner', 'valid_from'], name='one_nutrition_target_per_date')]

    @classmethod
    def for_date(cls, user, day):
        return cls.objects.filter(owner=user, valid_from__lte=day).order_by('-valid_from').first()


class FoodReport(TimeStampedModel):
    """A user's note that a shared food has wrong values; reviewed in the admin."""

    food = models.ForeignKey(Food, on_delete=models.CASCADE, related_name='reports')
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    reason = models.CharField(max_length=300)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

