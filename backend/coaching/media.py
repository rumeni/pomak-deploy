"""Images people send: re-encoded on the server before anything is stored.

Every upload is decoded with Pillow, turned upright, shrunk and saved again as a plain JPEG. This
drops all metadata (GPS position, camera, time), refuses anything that is not a real picture and
keeps each stored image small (they live in the database, served only to who may see them).
"""

from datetime import timedelta
from io import BytesIO

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

MAX_UPLOAD_BYTES = 4 * 1024 * 1024  # also under the 4.5 MB request limit of the hosting
MAX_PIXELS = 40_000_000
MESSAGE_SIDE = 1600
PHOTO_SIDE = 512
ALLOWED_FORMATS = {'JPEG', 'PNG', 'WEBP', 'GIF'}


def process_image(upload, max_side):
    """Return (jpeg bytes, width, height) or raise a validation error."""
    if upload is None:
        raise ValidationError({'file': _('Choose a picture.')})
    if upload.size > MAX_UPLOAD_BYTES:
        raise ValidationError({'file': _('The picture is too large (at most 4 MB).')})
    try:
        image = Image.open(upload)
        if image.format not in ALLOWED_FORMATS or image.width * image.height > MAX_PIXELS:
            raise ValueError('format or size')
        image.verify()
        upload.seek(0)
        image = Image.open(upload)
        image.seek(0)
        image = ImageOps.exif_transpose(image)
        if image.mode in ('RGBA', 'LA', 'P'):
            image = image.convert('RGBA')
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[-1])
            image = background
        else:
            image = image.convert('RGB')
        image.thumbnail((max_side, max_side))
        out = BytesIO()
        image.save(out, 'JPEG', quality=80, optimize=True, progressive=True)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError):
        raise ValidationError({'file': _('That file is not a picture we can use.')})
    return out.getvalue(), image.width, image.height


def delete_orphan_images(now=None):
    """Pictures uploaded but never sent within a day are removed (daily maintenance).

    Per collaboration, under its lock (the same lock a message takes before attaching a picture),
    and re-checked under it: a picture being sent right now is never deleted.
    """
    from .models import CoachConnection, MessageImage

    cutoff = (now or timezone.now()) - timedelta(days=1)
    stale = MessageImage.objects.filter(message__isnull=True, created_at__lt=cutoff)
    deleted = 0
    for connection_id in set(stale.values_list('connection_id', flat=True)):
        with transaction.atomic():
            CoachConnection.objects.select_for_update().filter(pk=connection_id).first()
            count, _rows = MessageImage.objects.filter(
                connection_id=connection_id, message__isnull=True, created_at__lt=cutoff,
            ).delete()
            deleted += count
    return deleted
