from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class PushDevice(TimeStampedModel):
    """One device (a browser subscription or an Android FCM token) that receives push for a user.

    The user turns it on per device; signing out on that device removes it. A token belongs to
    one user at a time: signing in as someone else on the same device moves it.
    """

    class Kind(models.TextChoices):
        WEB = 'web', 'Web push'
        FCM = 'fcm', 'Firebase Cloud Messaging'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='push_devices')
    kind = models.CharField(max_length=3, choices=Kind.choices)
    # The web push endpoint URL, or the FCM registration token.
    token = models.TextField(unique=True)
    # Web push only: the browser's public key and auth secret (base64url).
    p256dh = models.CharField(max_length=200, blank=True)
    auth = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ['-updated_at']
