"""Progress photos: the athlete's own pictures by day, and his coach's view of them.

Uploads are re-encoded like message pictures (coaching.media: upright, smaller, plain JPEG with no
metadata) and stored in the database. Only the owner sees them, and a coach only while the
client shares measurements with him; the pictures are never cached by the browser.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from coaching.media import process_image
from coaching.views import connection_for_coach, image_response

from .models import ProgressPhoto

PHOTO_SIDE = 1280
MAX_PHOTOS = 500
MAX_DAILY_PHOTOS = 20


def photo_summary(photo):
    return {
        'id': str(photo.id), 'taken_on': photo.taken_on, 'pose': photo.pose, 'note': photo.note,
        'width': photo.width, 'height': photo.height,
    }


def photo_list(user):
    return [photo_summary(p) for p in ProgressPhoto.objects.filter(user=user).defer('data')[:MAX_PHOTOS]]


class PhotoUploadSerializer(serializers.Serializer):
    # Client-made ID: a retried upload (lost response) never stores the picture twice.
    id = serializers.UUIDField(required=False)
    taken_on = serializers.DateField()
    pose = serializers.ChoiceField(choices=ProgressPhoto.Pose.choices, default=ProgressPhoto.Pose.FRONT)
    note = serializers.CharField(max_length=200, allow_blank=True, default='')

    def validate_taken_on(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError(_('A measurement cannot be in the future.'))
        return value


class ProgressPhotosView(APIView):
    """The athlete's progress photos (newest first), and adding one."""

    parser_classes = [MultiPartParser]

    def get(self, request):
        return Response(photo_list(request.user))

    def post(self, request):
        meta = PhotoUploadSerializer(data=request.data)
        meta.is_valid(raise_exception=True)
        photo_id = meta.validated_data.get('id')
        if photo_id is not None:
            existing = ProgressPhoto.objects.defer('data').filter(pk=photo_id).first()
            if existing is not None:
                if existing.user_id != request.user.pk:
                    raise ValidationError({'id': _('This ID is already taken.')})
                return Response(photo_summary(existing), status=status.HTTP_200_OK)
        # The slow part (decoding) runs before taking the lock.
        data, width, height = process_image(request.FILES.get('file'), PHOTO_SIDE)
        with transaction.atomic():
            # One upload of this person at a time, so parallel uploads cannot all pass the limits.
            User.objects.select_for_update().filter(pk=request.user.pk).first()
            photos = ProgressPhoto.objects.filter(user=request.user)
            if photos.count() >= MAX_PHOTOS:
                raise ValidationError({'file': _('You have too many progress photos. Delete some first.')})
            if photos.filter(created_at__gte=timezone.now() - timedelta(days=1)).count() >= MAX_DAILY_PHOTOS:
                raise ValidationError({'file': _('You have added many pictures today. Try again tomorrow.')})
            photo = ProgressPhoto.objects.create(
                user=request.user, data=data, width=width, height=height, size=len(data),
                **{key: value for key, value in meta.validated_data.items() if key != 'id'},
                **({'id': photo_id} if photo_id is not None else {}),
            )
        return Response(photo_summary(photo), status=status.HTTP_201_CREATED)


class ProgressPhotoView(APIView):
    def delete(self, request, pk):
        deleted, _rows = ProgressPhoto.objects.filter(user=request.user, pk=pk).delete()
        if not deleted:
            raise NotFound()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProgressPhotoImageView(APIView):
    def get(self, request, pk):
        data = ProgressPhoto.objects.filter(user=request.user, pk=pk).values_list('data', flat=True).first()
        if data is None:
            raise NotFound()
        return image_response(data)


def shared_client(request, client_id):
    """The coach's active client, or None while the client does not share measurements."""
    connection = connection_for_coach(request, client_id)
    return connection.client if connection.share_measurements else None


class CoachClientPhotosView(APIView):
    """A client's progress photos for his coach: null while measurements are not shared."""

    def get(self, request, client_id):
        client = shared_client(request, client_id)
        return Response(photo_list(client) if client else None)


class CoachClientPhotoImageView(APIView):
    def get(self, request, client_id, pk):
        client = shared_client(request, client_id)
        data = ProgressPhoto.objects.filter(user=client, pk=pk).values_list('data', flat=True).first() if client else None
        if data is None:
            raise NotFound()
        return image_response(data)
