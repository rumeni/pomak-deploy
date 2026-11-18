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


class PushMessage(TimeStampedModel):
    """A notification waiting to be delivered (the outbox). Written in the same transaction as
    the event that caused it; removed once delivered, after a few attempts, or after an hour."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    payload = models.JSONField()
    attempts = models.PositiveSmallIntegerField(default=0)
    # On a retry: only the devices that have not got it yet (null: all of the user's devices).
    devices = models.JSONField(null=True, blank=True)
    # A worker is delivering it until then (a crashed worker's claim simply expires).
    claimed_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['created_at'], name='push_msg_created_idx')]
