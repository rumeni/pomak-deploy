from django.conf import settings
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
