from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from core.models import TimeStampedModel
from core.text import normalize_search

# RPE (rate of perceived exertion) in half steps, 1-10. 10 = nothing left in the tank.
RPE_VALIDATORS = [MinValueValidator(1), MaxValueValidator(10)]
SCALE_VALIDATORS = [MinValueValidator(1), MaxValueValidator(5)]
READINESS_FIELDS = ('sleep_hours', 'hydration', 'stress', 'motivation', 'soreness_upper', 'soreness_lower')


class Exercise(TimeStampedModel):
    """Vežba iz zajedničke biblioteke (owner=None) ili lična vežba korisnika."""

    class Equipment(models.TextChoices):
        BARBELL = 'barbell', _('Barbell')
        DUMBBELL = 'dumbbell', _('Dumbbells')
        MACHINE = 'machine', _('Machine')
        CABLE = 'cable', _('Cable')
        BODYWEIGHT = 'bodyweight', _('Bodyweight')
        KETTLEBELL = 'kettlebell', _('Kettlebell')
        BAND = 'band', _('Resistance band')
        OTHER = 'other', _('Other')

    class Measurement(models.TextChoices):
        WEIGHT_REPS = 'weight_reps', _('Weight and reps')
        BODYWEIGHT_REPS = 'bodyweight_reps', _('Bodyweight reps')
        WEIGHTED_BODYWEIGHT = 'weighted_bodyweight', _('Bodyweight + added weight')
        ASSISTED_BODYWEIGHT = 'assisted_bodyweight', _('Assisted bodyweight')
        DURATION = 'duration', _('Duration')
        DISTANCE_DURATION = 'distance_duration', _('Distance and duration')

    class LoadMode(models.TextChoices):
        TOTAL = 'total', _('Total weight')
        PER_SIDE = 'per_side', _('Per dumbbell / side')

    class Muscle(models.TextChoices):
        CHEST = 'chest', _('Chest')
        BACK = 'back', _('Back')
        SHOULDERS = 'shoulders', _('Shoulders')
        BICEPS = 'biceps', _('Biceps')
        TRICEPS = 'triceps', _('Triceps')
        LEGS = 'legs', _('Legs')
        GLUTES = 'glutes', _('Glutes')
        CORE = 'core', _('Core')
        FULL_BODY = 'full_body', _('Full body')
        CARDIO = 'cardio', _('Cardio')

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name='custom_exercises',
    )
    # Stabilan ključ zajedničkih vežbi, da kasnija ažuriranja biblioteke nađu isti zapis.
    slug = models.SlugField(max_length=80, unique=True, null=True, blank=True)
    name = models.CharField(max_length=120)
    # Naziv na engleskom za zajedničku biblioteku; lične vežbe imaju samo naziv koji je korisnik upisao.
    name_en = models.CharField(max_length=120, blank=True)
    aliases = models.CharField(max_length=300, blank=True, help_text=_('Other names, separated by commas.'))
    search_name = models.CharField(max_length=1300, editable=False, db_index=True)
    equipment = models.CharField(max_length=20, choices=Equipment.choices)
    measurement = models.CharField(max_length=30, choices=Measurement.choices)
    load_mode = models.CharField(max_length=10, choices=LoadMode.choices, default=LoadMode.TOTAL)
    muscle = models.CharField(max_length=20, choices=Muscle.choices)
    instructions = models.TextField(blank=True)
    # Uputstvo na engleskom (zajednička biblioteka); prikazuje se po jeziku aplikacije kao i naziv.
    instructions_en = models.TextField(blank=True)
    # Vežba se nikad ne briše: stari rezultati moraju da ostanu čitljivi.
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.search_name = normalize_search(f'{self.name} {self.name_en} {self.aliases}')
        super().save(*args, **kwargs)

    @classmethod
    def visible_to(cls, user):
        return cls.objects.filter(Q(owner__isnull=True) | Q(owner=user))


class Routine(TimeStampedModel):
    """Ponovljiv trening: redosled vežbi i planirane serije."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='routines')
    name = models.CharField(max_length=100)
    notes = models.TextField(blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.name


class RoutineExercise(TimeStampedModel):
    routine = models.ForeignKey(Routine, on_delete=models.CASCADE, related_name='exercises')
    exercise = models.ForeignKey(Exercise, on_delete=models.RESTRICT, related_name='+')
    position = models.PositiveSmallIntegerField()
    rest_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['position']


class RoutineSet(TimeStampedModel):
    """Planirana serija. Polja koja se koriste zavise od vrste merenja vežbe."""

    class SetType(models.TextChoices):
        WARMUP = 'warmup', _('Warm-up')
        WORKING = 'working', _('Working')

    routine_exercise = models.ForeignKey(RoutineExercise, on_delete=models.CASCADE, related_name='sets')
    position = models.PositiveSmallIntegerField()
    set_type = models.CharField(max_length=10, choices=SetType.choices, default=SetType.WORKING)
    reps_min = models.PositiveSmallIntegerField(null=True, blank=True)
    reps_max = models.PositiveSmallIntegerField(null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    distance_m = models.PositiveIntegerField(null=True, blank=True)
    # Target intensity prescribed for the set (e.g. 3 x 5 @ RPE 8).
    rpe = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True, validators=RPE_VALIDATORS)

    class Meta:
        ordering = ['position']


class WorkoutSession(TimeStampedModel):
    """Odrađen trening. Čuva plan kakav je bio na početku (plan_snapshot), pa kasnije
    izmene rutine ne menjaju istoriju."""

    class Feeling(models.IntegerChoices):
        VERY_HARD = 1, _('Very hard')
        HARD = 2, _('Hard')
        OK = 3, _('Okay')
        GOOD = 4, _('Good')
        GREAT = 5, _('Great')

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='workout_sessions')
    routine = models.ForeignKey(Routine, null=True, blank=True, on_delete=models.SET_NULL, related_name='sessions')
    name = models.CharField(max_length=100)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField()
    plan_snapshot = models.JSONField(null=True, blank=True)
    feeling = models.PositiveSmallIntegerField(choices=Feeling.choices, null=True, blank=True)
    notes = models.TextField(blank=True)

    # Pre-workout readiness check-in. Every answer is optional. Scales run 1-5 where a
    # higher number means "more of it" (more stress, more soreness), not "better".
    sleep_hours = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(14)])
    hydration = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE_VALIDATORS)
    stress = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE_VALIDATORS)
    motivation = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE_VALIDATORS)
    soreness_upper = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE_VALIDATORS)
    soreness_lower = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE_VALIDATORS)
    # Set when the athlete corrects a finished workout, so the coach can see it was changed.
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']
        indexes = [models.Index(fields=['owner', '-started_at'])]

    def __str__(self):
        return f'{self.name} ({self.started_at:%Y-%m-%d})'


class SessionExercise(TimeStampedModel):
    session = models.ForeignKey(WorkoutSession, on_delete=models.CASCADE, related_name='exercises')
    exercise = models.ForeignKey(Exercise, on_delete=models.RESTRICT, related_name='+')
    position = models.PositiveSmallIntegerField()
    notes = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['position']


class SetLog(TimeStampedModel):
    """Potvrđena serija. Nepotvrđene (samo ponuđene) vrednosti se nikad ne čuvaju kao rezultat."""

    session_exercise = models.ForeignKey(SessionExercise, on_delete=models.CASCADE, related_name='sets')
    position = models.PositiveSmallIntegerField()
    set_type = models.CharField(max_length=10, choices=RoutineSet.SetType.choices, default=RoutineSet.SetType.WORKING)
    weight_kg = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    reps = models.PositiveSmallIntegerField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    distance_m = models.PositiveIntegerField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # How hard the set felt (RPE); optional.
    rpe = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True, validators=RPE_VALIDATORS)
    # Ko je upisao rezultat; u fazi 2 to može biti i trener tokom treninga uživo.
    logged_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        ordering = ['position']
