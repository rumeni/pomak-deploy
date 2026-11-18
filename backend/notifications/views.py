from django.db import transaction
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from core.views import require_object_body

from .models import PushDevice
from .push import fcm_enabled, vapid_public_key, web_push_enabled

MAX_DEVICES = 10


class PushConfigView(APIView):
    """Which push channels this server can send: the app offers only those."""

    def get(self, request):
        return Response({
            'web_public_key': vapid_public_key() if web_push_enabled() else None,
            'fcm': fcm_enabled(),
            'devices': PushDevice.objects.filter(user=request.user).count(),
        })


class DeviceSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=PushDevice.Kind.choices)
    token = serializers.CharField(max_length=2000)
    p256dh = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    auth = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')

    def validate(self, data):
        if data['kind'] == PushDevice.Kind.WEB:
            if not data['token'].startswith('https://'):
                raise serializers.ValidationError({'token': 'A web push endpoint must be an https URL.'})
            if not data['p256dh'] or not data['auth']:
                raise serializers.ValidationError({'p256dh': 'A web push subscription needs its keys.'})
        return data


class RemoveSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=2000)


class DevicesView(APIView):
    @transaction.atomic
    def post(self, request):
        """Turn push on for this device (or refresh its subscription)."""
        serializer = DeviceSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        PushDevice.objects.update_or_create(token=data['token'], defaults={
            'user': request.user, 'kind': data['kind'], 'p256dh': data['p256dh'], 'auth': data['auth'],
        })
        stale = PushDevice.objects.filter(user=request.user).values_list('pk', flat=True)[MAX_DEVICES:]
        PushDevice.objects.filter(pk__in=list(stale)).delete()
        return Response({'ok': True}, status=201)


class DeviceRemoveView(APIView):
    def post(self, request):
        """Turn push off for this device (also on sign-out). Only the user's own token."""
        serializer = RemoveSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        PushDevice.objects.filter(user=request.user, token=serializer.validated_data['token']).delete()
        return Response({'ok': True})
