from django.db import transaction
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.recovery_views import valid_qstash_signature
from core.views import require_object_body

from .models import PushDevice
from .push import WORKER_BUDGET, allowed_endpoint, drain, fcm_enabled, publish_drain, valid_keys, vapid_public_key, web_push_enabled, worker_url

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
            # Only the push services of real browsers: the server never calls anywhere else.
            if not allowed_endpoint(data['token']):
                raise serializers.ValidationError({'token': 'Not a browser push service endpoint.'})
            if not valid_keys(data['p256dh'], data['auth']):
                raise serializers.ValidationError({'p256dh': 'Invalid subscription keys.'})
        elif len(data['token']) > 512 or not data['token'].isprintable() or ' ' in data['token']:
            raise serializers.ValidationError({'token': 'Invalid device token.'})
        return data


class RemoveSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=2000)
    # Without a session (after sign-out): the account the device was registered for.
    user_id = serializers.UUIDField(required=False)


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
    """Turn push off for a device. Signed in: the user's own token. Signed out (a sign-out that was
    offline, or a registration that finished after it): the token itself and the account it was
    for. Only the device has its token, so this can only ever switch that device off."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RemoveSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if request.user.is_authenticated:
            owner = request.user.pk
        elif data.get('user_id'):
            owner = data['user_id']
        else:
            return Response({'user_id': ['Required without a session.']}, status=400)
        PushDevice.objects.filter(user_id=owner, token=data['token']).delete()
        return Response({'ok': True})


@csrf_exempt
@require_POST
def push_worker(request):
    """Drain the push outbox. Reachable only with a QStash signature for PUSH_WORKER_URL."""
    if not worker_url() or not valid_qstash_signature(request.headers.get('Upstash-Signature', ''), request.body, subject=worker_url()):
        return HttpResponse(status=403)
    if drain(WORKER_BUDGET):
        publish_drain()  # more left: continue in a fresh invocation
    return HttpResponse(status=204)

