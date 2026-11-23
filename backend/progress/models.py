from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from core.models import TimeStampedModel


class Measurement(TimeStampedModel):
    """Jedno telesno merenje. Više merenja istog dana je dozvoljeno (npr. jutro i veče)."""

    class Kind(models.TextChoices):
        WEIGHT = 'weight', _('Body weight')
        WAIST = 'waist', _('Waist')
        CHEST = 'chest', _('Chest')
        HIPS = 'hips', _('Hips')
        ARM = 'arm', _('Upper arm')
        THIGH = 'thigh', _('Thigh')

    UNITS = {Kind.WEIGHT: 'kg'}  # svi obimi su u cm

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='measurements')
    kind = models.CharField(max_length=20, choices=Kind.choices)
    value = models.DecimalField(max_digits=6, decimal_places=2)
    measured_on = models.DateField()
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['-measured_on', '-created_at']
        indexes = [models.Index(fields=['user', 'kind', '-measured_on'])]

    @property
    def unit(self) -> str:
        return self.UNITS.get(self.kind, 'cm')


class Goal(TimeStampedModel):
    """Cilj napretka: telesna mera (težina ili obim) ili broj treninga nedeljno.

    Stanje menja korisnik (ostvaren / odustao); aplikacija samo pokazuje koliko je blizu.
    Aktivan može biti jedan cilj po vrsti.
    """

    class Kind(models.TextChoices):
        WEIGHT = 'weight', _('Body weight')
        WAIST = 'waist', _('Waist')
        CHEST = 'chest', _('Chest')
        HIPS = 'hips', _('Hips')
        ARM = 'arm', _('Upper arm')
        THIGH = 'thigh', _('Thigh')
        WORKOUTS = 'workouts_per_week', _('Workouts per week')

    class Status(models.TextChoices):
        ACTIVE = 'active', _('Active')
        ACHIEVED = 'achieved', _('Achieved')
        ABANDONED = 'abandoned', _('Stopped')

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='goals')
    kind = models.CharField(max_length=20, choices=Kind.choices)
    # Polazna vrednost (merenje u trenutku postavljanja); za broj treninga je nema.
    start_value = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    target_value = models.DecimalField(max_digits=6, decimal_places=2)
    start_date = models.DateField()
    target_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    closed_on = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['-start_date', '-created_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'kind'], condition=models.Q(status='active'), name='one_active_goal_per_kind'),
        ]


class WeeklyCheckIn(TimeStampedModel):
    """The athlete's own look back at a week (Monday = week_start). Every answer is optional.

    Scales run 1-5 (higher = better). With a coach, the coach sees it with the week; without one
    it is just the athlete's note to self.
    """

    SCALE = [MinValueValidator(1), MaxValueValidator(5)]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='weekly_checkins')
    week_start = models.DateField()
    energy = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE)
    progress = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE)
    nutrition = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE)
    satisfaction = models.PositiveSmallIntegerField(null=True, blank=True, validators=SCALE)
    hardest = models.CharField(max_length=500, blank=True)
    notes = models.CharField(max_length=1000, blank=True)
    # The collaboration it was written for (the athlete was told the coach sees it). Null: a
    # private note, never shown to any coach, also not to a later one.
    shared_with = models.ForeignKey('coaching.CoachConnection', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'week_start'], name='one_checkin_per_week')]


class ProgressPhoto(TimeStampedModel):
    """A progress picture (front, side or back) on a day, next to that day's measurements.

    Re-encoded on upload (no metadata) and stored in the database, like message pictures. Only
    the owner sees it, and a coach only while the client shares measurements with him.
    """

    class Pose(models.TextChoices):
        FRONT = 'front', _('From the front')
        SIDE = 'side', _('From the side')
        BACK = 'back', _('From behind')

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='progress_photos')
    taken_on = models.DateField()
    pose = models.CharField(max_length=10, choices=Pose.choices, default=Pose.FRONT)
    note = models.CharField(max_length=200, blank=True)
    data = models.BinaryField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    size = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-taken_on', '-created_at']
        indexes = [models.Index(fields=['user', '-taken_on'], name='progress_photo_user_day_idx')]
