import uuid

from django.db import models


class TimeStampedModel(models.Model):
    """Osnova za sve zapise.

    ID je UUID koji može da napravi i klijent: zapis nastao bez interneta dobija
    isti ID kad se kasnije pošalje, pa ponovljeno slanje ne pravi duplikat.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
