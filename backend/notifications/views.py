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
from .push import WORKER_BUDGET, allowed_endpoint, drain, fcm_enabled, schedule_next, valid_keys, vapid_public_key, web_push_enabled, worker_url
from .registrations import register, remove_legacy, revoke

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
    # The device's ID for this registration attempt (older apps: made here).
    attempt = serializers.UUIDField(required=False)

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
    # The registration attempt to undo (also a capability: only the device knows it).
    attempt = serializers.UUIDField(required=False)
    # Without a session (after sign-out): the account the attempt was for.
    user_id = serializers.UUIDField(required=False)
    # Older apps, signed in only: the device token.
    token = serializers.CharField(max_length=2000, required=False)


class DevicesView(APIView):
    @transaction.atomic
    def post(self, request):
        """Turn push on for this device (or refresh its subscription)."""
        serializer = DeviceSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # An older app sends no attempt: its row is marked legacy (it could never name an attempt).
        attempt = data.get('attempt')
        if not register(request.user, attempt, token=data['token'], kind=data['kind'], p256dh=data['p256dh'], auth=data['auth']):
            # Revoked before it arrived (signed out meanwhile): never registered.
            return Response({'code': 'push_revoked', 'detail': 'This registration was revoked.'}, status=409)
        stale = PushDevice.objects.filter(user=request.user).values_list('pk', flat=True)[MAX_DEVICES:]
        PushDevice.objects.filter(pk__in=list(stale)).delete()
        return Response({'ok': True, 'attempt': str(attempt) if attempt else None}, status=201)


class DeviceRemoveView(APIView):
    """Undo a registration attempt: the device's ID for it plus the account (no session needed:
    an offline sign-out, a registration answered after sign-out). The attempt ID is random and
    known only to the device; the provider token is never sent. Revoking is final for that attempt
    (a delayed registration of it is refused) and never touches a later opt-in."""

    permission_classes = [AllowAny]
    # Anyone may call it: bounded per client (tombstones of made-up attempts expire in a week).
    throttle_scope = 'push_revoke'

    def post(self, request):
        serializer = RemoveSerializer(data=require_object_body(request))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data.get('attempt'):
            owner = request.user.pk if request.user.is_authenticated else data.get('user_id')
            if owner is None:
                return Response({'user_id': ['Required without a session.']}, status=400)
            revoke(owner, data['attempt'])
        elif request.user.is_authenticated and data.get('token'):
            remove_legacy(request.user.pk, data['token'])
        else:
            return Response({'attempt': ['Required.']}, status=400)
        return Response({'ok': True})


@csrf_exempt
@require_POST
def push_worker(request):
    """Drain the push outbox. Reachable only with a QStash signature for PUSH_WORKER_URL."""
    if not worker_url() or not valid_qstash_signature(request.headers.get('Upstash-Signature', ''), request.body, subject=worker_url()):
        return HttpResponse(status=403)
    # Run again when the queue next has work (now, or when a retry's backoff ends). If that cannot
    # be scheduled, answer with an error so QStash retries this call instead of the work being
    # silently dropped.
    if not schedule_next(drain(WORKER_BUDGET)):
        return HttpResponse(status=503)
    return HttpResponse(status=204)

