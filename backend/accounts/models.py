import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError('Email is required.')
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        Profile.objects.create(user=user)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    # Changing the password invalidates JWT access AND refresh tokens from all
    # prior sessions, including older APKs which have no session_version claim.
    session_version = models.PositiveIntegerField(default=0)
    # Existing accounts remain supported. New signups require verification
    # only when account emails are enabled and the clients can show the flow.
    email_verification_required = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = 'email'

    def __str__(self):
        return self.email


class Profile(models.Model):
    class Sex(models.TextChoices):
        MALE = 'male', _('Male')
        FEMALE = 'female', _('Female')

    class Experience(models.TextChoices):
        BEGINNER = 'beginner', _('Beginner')
        INTERMEDIATE = 'intermediate', _('Intermediate')
        ADVANCED = 'advanced', _('Advanced')

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    display_name = models.CharField(max_length=80, blank=True)
    language = models.CharField(max_length=10, choices=settings.LANGUAGES, default='sr-latn')
    # Trenerska uloga se dodaje nalogu; trener i dalje ima svoj trening i ishranu.
    is_coach = models.BooleanField(default=False)

    tracks_training = models.BooleanField(default=True)
    tracks_nutrition = models.BooleanField(default=True)
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)

    # Podaci za trening
    training_experience = models.CharField(max_length=20, choices=Experience.choices, blank=True)
    weekly_workouts_target = models.PositiveSmallIntegerField(null=True, blank=True)

    # Podaci za procenu kalorija; nisu obavezni korisniku koji prati samo trening.
    sex = models.CharField(max_length=10, choices=Sex.choices, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    height_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)

    # Obroci u dnevniku: [{"key": "breakfast", "name": "", "enabled": true}, ...] redom prikaza.
    # Prazno ime = podrazumevani naziv na jeziku aplikacije. null = podrazumevana 4 obroka.
    meals = models.JSONField(null=True, blank=True)

    def __str__(self):
        return self.display_name or self.user.email


class AuthThrottleBucket(models.Model):
    """Cross-instance login rate limiting; only hashed identities are persisted."""
    key = models.CharField(max_length=64)
    window_start = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['key', 'window_start'], name='auth_throttle_bucket_key_window'),
        ]
