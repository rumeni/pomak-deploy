"""Push devices, Web Push encryption and VAPID, FCM, and what a notification may contain (T3b)."""

import json
import time
from datetime import timedelta
import os
from uuid import uuid4
from unittest import mock
from urllib.error import HTTPError

import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.test import override_settings
from rest_framework.test import APITestCase, APITransactionTestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from coaching.models import CoachConnection
from notifications import push
from notifications.models import PushDevice, PushMessage


def keypair():
    private = ec.generate_private_key(ec.SECP256R1())
    public = private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return private, public


VAPID_PRIVATE, VAPID_PUBLIC = keypair()
VAPID_ENV = {
    'WEB_PUSH_VAPID_PUBLIC_KEY': push.b64url(VAPID_PUBLIC),
    'WEB_PUSH_VAPID_PRIVATE_KEY': push.b64url(VAPID_PRIVATE.private_numbers().private_value.to_bytes(32, 'big')),
    'WEB_PUSH_CONTACT': 'mailto:ops@example.test',
}


def decrypt(body, ua_private, ua_public, auth):
    """What the browser does (RFC 8291) — proves the server's encryption is readable."""
    salt, idlen = body[:16], body[20]
    as_public = body[21:21 + idlen]
    ciphertext = body[21 + idlen:]
    shared = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    ikm = HKDF(hashes.SHA256(), 32, salt=auth, info=b'WebPush: info\x00' + ua_public + as_public).derive(shared)
    cek = HKDF(hashes.SHA256(), 16, salt=salt, info=b'Content-Encoding: aes128gcm\x00').derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt=salt, info=b'Content-Encoding: nonce\x00').derive(ikm)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert plain.endswith(b'\x02')
    return plain[:-1]


class Response:
    def close(self):
        pass


class PushTestCase(APITestCase):
    def setUp(self):
        self.coach = self.user('push-coach@example.test', coach=True)
        self.ana = self.user('push-ana@example.test')
        self.connection = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.ua_private, self.ua_public = keypair()
        self.auth_secret = os.urandom(16)

    def user(self, email, *, coach=False):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.save()
        return user

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def subscribe(self, user, endpoint='https://fcm.googleapis.com/fcm/send/sub-1'):
        self.as_user(user)
        return self.client.post('/api/push/devices/', {
            'kind': 'web', 'token': endpoint, 'p256dh': push.b64url(self.ua_public), 'auth': push.b64url(self.auth_secret),
        }, format='json')


class DeviceTests(PushTestCase):
    def test_config_reports_only_configured_channels(self):
        self.as_user(self.ana)
        with mock.patch.dict(os.environ, {}, clear=False):
            for key in (*VAPID_ENV, 'FCM_SERVICE_ACCOUNT'):
                os.environ.pop(key, None)
            self.assertEqual(self.client.get('/api/push/config/').data, {'web_public_key': None, 'fcm': False, 'devices': 0})
        with mock.patch.dict(os.environ, VAPID_ENV):
            self.assertEqual(self.client.get('/api/push/config/').data['web_public_key'], VAPID_ENV['WEB_PUSH_VAPID_PUBLIC_KEY'])

    def test_a_device_belongs_to_one_user_and_only_he_removes_it(self):
        self.assertEqual(self.subscribe(self.ana).status_code, 201)
        self.assertEqual(self.subscribe(self.ana).status_code, 201)  # refresh, not a copy
        self.assertEqual(PushDevice.objects.count(), 1)
        # Signed in as someone else on the same browser: the device moves.
        self.subscribe(self.coach)
        self.assertEqual(PushDevice.objects.get().user, self.coach)
        self.as_user(self.ana)
        self.client.post('/api/push/devices/remove/', {'token': 'https://fcm.googleapis.com/fcm/send/sub-1'}, format='json')
        self.assertTrue(PushDevice.objects.exists())
        self.as_user(self.coach)
        self.client.post('/api/push/devices/remove/', {'token': 'https://fcm.googleapis.com/fcm/send/sub-1'}, format='json')
        self.assertFalse(PushDevice.objects.exists())

    def test_invalid_subscriptions_are_refused_and_devices_are_capped(self):
        self.as_user(self.ana)
        self.assertEqual(self.client.post('/api/push/devices/', {'kind': 'web', 'token': 'http://x.test/1', 'p256dh': 'a', 'auth': 'b'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/push/devices/', {'kind': 'web', 'token': 'https://x.test/1'}, format='json').status_code, 400)
        for i in range(12):
            self.subscribe(self.ana, f'https://fcm.googleapis.com/fcm/send/sub-{i}')
        self.assertEqual(PushDevice.objects.filter(user=self.ana).count(), 10)


class WebPushTests(PushTestCase):
    def test_encryption_is_readable_by_the_browser(self):
        body = push.encrypt(b'{"title":"x"}', push.b64url(self.ua_public), push.b64url(self.auth_secret))
        self.assertEqual(decrypt(body, self.ua_private, self.ua_public, self.auth_secret), b'{"title":"x"}')

    @mock.patch.dict(os.environ, VAPID_ENV)
    def test_a_new_message_pushes_who_wrote_never_what(self):
        self.subscribe(self.coach)
        sent = []

        def fake_urlopen(request, timeout):
            sent.append(request)
            return Response()

        self.as_user(self.ana)
        with mock.patch('notifications.push.http_post', fake_urlopen), self.captureOnCommitCallbacks(execute=True):
            self.client.post('/api/coach/messages/', {'text': 'Boli me koleno posle čučnja'}, format='json')
        self.assertEqual(len(sent), 1)
        request = sent[0]
        self.assertEqual(request.full_url, 'https://fcm.googleapis.com/fcm/send/sub-1')
        self.assertEqual(request.headers['Content-encoding'], 'aes128gcm')
        token = request.headers['Authorization'].split('t=')[1].split(',')[0]
        claims = jwt.decode(token, VAPID_PRIVATE.public_key(), algorithms=['ES256'], audience='https://fcm.googleapis.com')
        self.assertEqual(claims['sub'], 'mailto:ops@example.test')
        payload = json.loads(decrypt(request.data, self.ua_private, self.ua_public, self.auth_secret))
        self.assertEqual(payload['url'], f'/trener/poruke/{self.connection.pk}')
        self.assertNotIn('koleno', json.dumps(payload, ensure_ascii=False))
        self.assertEqual(payload['body'], 'Nova poruka.')

    @mock.patch.dict(os.environ, VAPID_ENV)
    def test_a_gone_subscription_is_removed_and_nothing_breaks(self):
        self.subscribe(self.coach)

        def gone(request, timeout):
            raise HTTPError(request.full_url, 410, 'Gone', {}, None)

        self.as_user(self.ana)
        with mock.patch('notifications.push.http_post', gone), self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post('/api/coach/messages/', {'text': 'Hej'}, format='json').status_code, 201)
        self.assertFalse(PushDevice.objects.exists())

    def test_nothing_is_sent_without_configuration_or_devices(self):
        with mock.patch('notifications.push.http_post') as urlopen, self.captureOnCommitCallbacks(execute=True):
            self.as_user(self.ana)
            self.client.post('/api/coach/messages/', {'text': 'Hej'}, format='json')
        urlopen.assert_not_called()


class FcmTests(PushTestCase):
    def test_android_devices_get_an_fcm_message(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        account = {
            'project_id': 'pomak-test', 'client_email': 'push@pomak-test.iam.gserviceaccount.com',
            'token_uri': 'https://oauth2.googleapis.com/token',
            'private_key': key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode(),
        }
        PushDevice.objects.create(user=self.ana, kind='fcm', token='fcm-token-1')
        sent = []

        class TokenResponse(Response):
            def read(self, *args):
                return json.dumps({'access_token': 'abc', 'expires_in': 3600}).encode()

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def fake_urlopen(request, timeout):
            sent.append(request)
            return TokenResponse()

        push._fcm_token.update(value=None, expires=0)
        with mock.patch.dict(os.environ, {'FCM_SERVICE_ACCOUNT': json.dumps(account)}), \
                mock.patch('notifications.push.http_post', fake_urlopen), self.captureOnCommitCallbacks(execute=True):
            self.as_user(self.coach)
            self.client.post('/api/coach/messages/', {'text': 'Tajni plan', 'client_id': str(self.ana.pk)}, format='json')
        self.assertEqual([r.full_url for r in sent], [
            'https://oauth2.googleapis.com/token', 'https://fcm.googleapis.com/v1/projects/pomak-test/messages:send',
        ])
        body = json.loads(sent[1].data)
        self.assertEqual(body['message']['token'], 'fcm-token-1')
        self.assertEqual(body['message']['data']['url'], '/trener')
        self.assertNotIn('Tajni', json.dumps(body))
        self.assertEqual(sent[1].headers['Authorization'], 'Bearer abc')


class EndpointSafetyTests(PushTestCase):
    def test_only_browser_push_services_are_accepted(self):
        good = ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x',
                'https://web.push.apple.com/x', 'https://wns2-db5p.notify.windows.com/w/?token=x']
        bad = ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest',
               'https://fcm.googleapis.com.evil.test/x', 'https://evil.test/fcm.googleapis.com', 'https://fcm.googleapis.com:8443/x',
               'https://user:pw@fcm.googleapis.com/x', 'https://notify.windows.com/x', 'https://x.notify.windows.com.evil.test/',
               'https://fcm.googleapis.com./x', 'https://[::1]/x', 'ftp://fcm.googleapis.com/x', 'https://fcm.googleapis.com:99999/x']
        for endpoint in good:
            self.assertTrue(push.allowed_endpoint(endpoint), endpoint)
        for endpoint in bad:
            self.assertFalse(push.allowed_endpoint(endpoint), endpoint)
            self.assertEqual(self.subscribe(self.ana, endpoint).status_code, 400, endpoint)
        self.assertFalse(PushDevice.objects.exists())

    def test_subscription_keys_must_be_real(self):
        self.as_user(self.ana)
        for p256dh, auth in (('AAAA', push.b64url(self.auth_secret)), (push.b64url(self.ua_public), 'AAAA'),
                             (push.b64url(b'\x04' + b'\x00' * 64), push.b64url(self.auth_secret))):
            response = self.client.post('/api/push/devices/', {'kind': 'web', 'token': 'https://fcm.googleapis.com/fcm/send/k',
                                                               'p256dh': p256dh, 'auth': auth}, format='json')
            self.assertEqual(response.status_code, 400)

    @mock.patch.dict(os.environ, VAPID_ENV)
    def test_an_old_unsafe_row_is_never_called_and_redirects_are_not_followed(self):
        PushDevice.objects.create(user=self.coach, kind='web', token='https://127.0.0.1/internal',
                                  p256dh=push.b64url(self.ua_public), auth=push.b64url(self.auth_secret))
        with mock.patch('notifications.push.http_post') as post, self.captureOnCommitCallbacks(execute=True):
            self.as_user(self.ana)
            self.client.post('/api/coach/messages/', {'text': 'Hej'}, format='json')
        post.assert_not_called()
        self.assertFalse(PushDevice.objects.exists())
        self.assertIsNone(push._NoRedirect().redirect_request(None, None, 302, 'Found', {}, 'https://127.0.0.1/'))


class OutboxTests(PushTestCase):
    @mock.patch.dict(os.environ, VAPID_ENV)
    def test_queued_with_the_event_and_dropped_if_it_rolls_back(self):
        from django.db import transaction

        self.subscribe(self.coach)
        with mock.patch('notifications.push.kick'):
            try:
                with transaction.atomic():
                    push.notify(self.coach, title='x', body='y', url='/', tag='t')
                    raise RuntimeError
            except RuntimeError:
                pass
        self.assertFalse(PushMessage.objects.exists())

    def test_stale_device_is_removed_only_if_not_registered_again(self):
        device = PushDevice.objects.create(user=self.ana, kind='web', token='https://fcm.googleapis.com/fcm/send/z',
                                           p256dh=push.b64url(self.ua_public), auth=push.b64url(self.auth_secret))
        PushDevice.objects.filter(pk=device.pk).update(updated_at=device.updated_at + timedelta(seconds=1))  # registered again
        PushDevice.objects.filter(pk=device.pk, token=device.token, updated_at=device.updated_at).delete()
        self.assertTrue(PushDevice.objects.exists())

    @override_settings(QSTASH_TOKEN='t', QSTASH_CURRENT_SIGNING_KEY='current-key', QSTASH_NEXT_SIGNING_KEY='next-key')
    def test_the_worker_needs_a_qstash_signature_for_its_own_url(self):
        url = 'https://api.example.test/api/internal/push-deliver/'
        with mock.patch.dict(os.environ, {'PUSH_WORKER_URL': url}):
            self.assertEqual(self.client.post('/api/internal/push-deliver/', b'{}', content_type='application/json').status_code, 403)
            import base64
            import hashlib
            import time as clock

            body_hash = base64.urlsafe_b64encode(hashlib.sha256(b'{}').digest()).decode().rstrip('=')
            now = int(clock.time())
            wrong = jwt.encode({'iss': 'Upstash', 'sub': 'https://other.test/', 'nbf': now, 'exp': now + 60, 'body': body_hash}, 'current-key', algorithm='HS256')
            self.assertEqual(self.client.post('/api/internal/push-deliver/', b'{}', content_type='application/json',
                                              HTTP_UPSTASH_SIGNATURE=wrong).status_code, 403)
            right = jwt.encode({'iss': 'Upstash', 'sub': url, 'nbf': now, 'exp': now + 60, 'body': body_hash}, 'next-key', algorithm='HS256')
            with mock.patch('notifications.views.drain', return_value=None) as drain:
                self.assertEqual(self.client.post('/api/internal/push-deliver/', b'{}', content_type='application/json',
                                                  HTTP_UPSTASH_SIGNATURE=right).status_code, 204)
            drain.assert_called_once()


class LogoutTests(PushTestCase):
    def test_signing_out_revokes_this_devices_registration_attempt(self):
        attempt = uuid4()
        self.as_user(self.ana)
        self.client.post('/api/push/devices/', {'kind': 'web', 'token': 'https://fcm.googleapis.com/fcm/send/sub-1', 'attempt': str(attempt),
                                                'p256dh': push.b64url(self.ua_public), 'auth': push.b64url(self.auth_secret)}, format='json')
        self.subscribe(self.ana, 'https://fcm.googleapis.com/fcm/send/other-device')
        refresh = RefreshToken.for_user(self.ana)
        response = self.client.post('/api/auth/logout/', {'refresh': str(refresh), 'push_attempt': str(attempt)}, format='json')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(list(PushDevice.objects.values_list('token', flat=True)), ['https://fcm.googleapis.com/fcm/send/other-device'])


class GenerationTests(PushTestCase):
    """A removal names the registration attempt it undoes; revoking it is final for that attempt."""

    def register(self, attempt, token='https://fcm.googleapis.com/fcm/send/g', user=None):
        self.as_user(user or self.ana)
        return self.client.post('/api/push/devices/', {'kind': 'web', 'token': token, 'attempt': str(attempt),
                                                       'p256dh': push.b64url(self.ua_public), 'auth': push.b64url(self.auth_secret)}, format='json')

    def revoke(self, attempt, user_id=None):
        self.client.force_authenticate(user=None)  # signed out
        body = {'attempt': str(attempt)}
        if user_id:
            body['user_id'] = str(user_id)
        return self.client.post('/api/push/devices/remove/', body, format='json')

    def test_revoked_before_the_registration_arrives_it_is_refused(self):
        attempt = uuid4()
        self.assertEqual(self.revoke(attempt, self.ana.pk).status_code, 200)
        late = self.register(attempt)
        self.assertEqual((late.status_code, late.data['code']), (409, 'push_revoked'))
        self.assertFalse(PushDevice.objects.exists())
        # A later, explicit opt-in (a new attempt) is valid.
        self.assertEqual(self.register(uuid4()).status_code, 201)
        self.assertTrue(PushDevice.objects.exists())

    def test_revoked_after_it_arrived_it_is_removed(self):
        attempt = uuid4()
        self.register(attempt)
        self.revoke(attempt, self.ana.pk)
        self.assertFalse(PushDevice.objects.exists())

    def test_an_old_revocation_never_removes_a_new_opt_in_with_the_same_token(self):
        old, new = uuid4(), uuid4()
        self.register(old)
        self.register(new)  # re-enabled; the provider gave the same token
        self.revoke(old, self.ana.pk)  # the pending removal of the old attempt arrives late
        self.assertEqual(PushDevice.objects.get().attempt, new)

    def test_signed_out_removal_needs_the_attempt_and_its_account(self):
        attempt = uuid4()
        self.register(attempt)
        self.assertEqual(self.revoke(attempt).status_code, 400)
        self.client.post('/api/push/devices/remove/', {'token': 'https://fcm.googleapis.com/fcm/send/g', 'user_id': str(self.ana.pk)}, format='json')
        self.assertTrue(PushDevice.objects.exists())  # a token alone does nothing without a session
        self.revoke(attempt, self.coach.pk)
        self.assertTrue(PushDevice.objects.exists())  # another account: nothing removed
        self.revoke(uuid4(), self.ana.pk)
        self.assertTrue(PushDevice.objects.exists())  # another attempt: nothing removed
        self.revoke(attempt, self.ana.pk)
        self.assertFalse(PushDevice.objects.exists())


class RetryTests(PushTestCase):
    def device(self, user, name):
        return PushDevice.objects.create(user=user, kind='web', token=f'https://fcm.googleapis.com/fcm/send/{name}',
                                         p256dh=push.b64url(self.ua_public), auth=push.b64url(self.auth_secret))

    @mock.patch.dict(os.environ, VAPID_ENV)
    def test_a_temporary_failure_is_retried_only_for_that_device_and_at_most_three_times(self):
        phone, laptop = self.device(self.ana, 'phone'), self.device(self.ana, 'laptop')
        sent = []

        def provider(request, timeout):
            sent.append(request.full_url.rsplit('/', 1)[1])
            if request.full_url.endswith('phone'):
                raise HTTPError(request.full_url, 503, 'Unavailable', {}, None)
            return Response()

        with mock.patch('notifications.push.kick'):
            push.notify(self.ana, title='x', body='y', url='/', tag='t')
        with mock.patch('notifications.push.http_post', provider):
            push.drain(5)
            self.assertEqual(sorted(sent), ['laptop', 'phone'])
            message = PushMessage.objects.get()
            self.assertEqual(message.devices, [str(phone.pk)])
            self.assertGreater(message.claimed_until, timezone.now())  # a little later, not at once
            for _ in range(3):
                PushMessage.objects.update(claimed_until=timezone.now() - timedelta(seconds=1))
                push.drain(5)
        self.assertEqual(sent.count('laptop'), 1)  # never delivered twice
        self.assertEqual(sent.count('phone'), 3)  # three attempts in all, then given up
        self.assertFalse(PushMessage.objects.exists())

    @mock.patch.dict(os.environ, VAPID_ENV)
    def test_a_final_refusal_is_not_retried(self):
        self.device(self.ana, 'phone')

        def refuse(request, timeout):
            raise HTTPError(request.full_url, 400, 'Bad', {}, None)

        with mock.patch('notifications.push.kick'):
            push.notify(self.ana, title='x', body='y', url='/', tag='t')
        with mock.patch('notifications.push.http_post', refuse):
            push.drain(5)
        self.assertFalse(PushMessage.objects.exists())


class GroupAssignTests(APITransactionTestCase):
    """Real commits (one per client, as in production), not one test transaction."""

    def user(self, email, *, coach=False):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.save()
        return user

    @mock.patch.dict(os.environ, VAPID_ENV)
    def test_assigning_a_program_to_many_clients_kicks_once_and_stays_quick(self):
        from coaching.models import ProgramTemplate, ProgramTemplateDay
        from training.models import Exercise, Routine, RoutineExercise, RoutineSet

        coach = self.user('group-coach@example.test', coach=True)
        ua_private, ua_public = keypair()
        connections = []
        for i in range(6):
            client = self.user(f'group-c{i}@example.test')
            connections.append(str(CoachConnection.objects.create(coach=coach, client=client).pk))
            PushDevice.objects.create(user=client, kind='web', token=f'https://fcm.googleapis.com/fcm/send/g{i}',
                                      p256dh=push.b64url(ua_public), auth=push.b64url(os.urandom(16)))
        bench = Exercise.objects.create(owner=None, slug='group-bench', name='Bench', equipment=Exercise.Equipment.BARBELL,
                                        measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST)
        routine = Routine.objects.create(owner=coach, name='Upper')
        item = RoutineExercise.objects.create(routine=routine, exercise=bench, position=0)
        RoutineSet.objects.create(routine_exercise=item, position=0, set_type=RoutineSet.SetType.WORKING, reps_min=8, reps_max=8)
        template = ProgramTemplate.objects.create(coach=coach, name='Program', weeks=4)
        ProgramTemplateDay.objects.create(template=template, weekday=0, routine=routine)

        def down(request, timeout):  # QStash and the push services are both unreachable
            raise TimeoutError('down')

        self.client.force_authenticate(user=coach)
        qstash = {'PUSH_WORKER_URL': 'https://api.example.test/api/internal/push-deliver/'}
        with override_settings(QSTASH_TOKEN='t', QSTASH_CURRENT_SIGNING_KEY='a', QSTASH_NEXT_SIGNING_KEY='b'), \
                mock.patch.dict(os.environ, qstash), \
                mock.patch('notifications.push.urllib.request.urlopen', side_effect=TimeoutError('down')) as publish, \
                mock.patch('notifications.push.http_post', down), \
                mock.patch('notifications.push.kick', wraps=push.kick) as kick:
            started = time.monotonic()
            response = self.client.post(f'/api/coach/templates/{template.pk}/assign/', {
                'connection_ids': connections, 'start_date': timezone.localdate().isoformat(), 'request_id': str(uuid4()),
            }, format='json')
            elapsed = time.monotonic() - started
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all(r['ok'] for r in response.data['results']))
        self.assertEqual(kick.call_count, 1)  # once for the request, not once per client
        self.assertEqual(publish.call_count, 1)
        self.assertLess(elapsed, push.KICK_BUDGET + 3)  # bounded even with everything down
        # Nothing lost: whatever was not sent waits in the outbox for the worker or the next drain.
        self.assertEqual(PushMessage.objects.count(), 6)


class WakeUpTests(PushTestCase):
    """A retry's backoff is scheduled with QStash: no later app traffic is needed."""

    @mock.patch.dict(os.environ, {**VAPID_ENV, 'PUSH_WORKER_URL': 'https://api.example.test/api/internal/push-deliver/'})
    @override_settings(QSTASH_TOKEN='t', QSTASH_CURRENT_SIGNING_KEY='current-key', QSTASH_NEXT_SIGNING_KEY='next-key')
    def test_the_worker_schedules_itself_for_a_retry_and_fails_loudly_if_it_cannot(self):
        import base64
        import hashlib

        PushDevice.objects.create(user=self.ana, kind='web', token='https://fcm.googleapis.com/fcm/send/only',
                                  p256dh=push.b64url(self.ua_public), auth=push.b64url(self.auth_secret))
        with mock.patch('notifications.push.kick'):
            push.notify(self.ana, title='x', body='y', url='/', tag='t')
        body_hash = base64.urlsafe_b64encode(hashlib.sha256(b'{}').digest()).decode().rstrip('=')
        now = int(time.time())
        signature = jwt.encode({'iss': 'Upstash', 'sub': 'https://api.example.test/api/internal/push-deliver/', 'nbf': now,
                                'exp': now + 60, 'body': body_hash}, 'current-key', algorithm='HS256')

        def unavailable(request, timeout):
            raise HTTPError(request.full_url, 503, 'Unavailable', {}, None)

        published = []

        class Accepted(Response):
            status = 201

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def publish(request, timeout):
            published.append(request)
            return Accepted()

        call = lambda: self.client.post('/api/internal/push-deliver/', b'{}', content_type='application/json',  # noqa: E731
                                        HTTP_UPSTASH_SIGNATURE=signature)
        with mock.patch('notifications.push.http_post', unavailable), mock.patch('notifications.push.urllib.request.urlopen', publish):
            self.assertEqual(call().status_code, 204)
        self.assertEqual(len(published), 1)
        delay = int(published[0].headers['Upstash-delay'].rstrip('s'))
        self.assertTrue(25 <= delay <= 31, delay)  # when the backoff ends, not right away
        # The delayed call comes: the retry goes out and nothing is left to schedule.
        PushMessage.objects.update(claimed_until=timezone.now() - timedelta(seconds=1))
        with mock.patch('notifications.push.http_post', return_value=Response()) as sent, \
                mock.patch('notifications.push.urllib.request.urlopen', publish):
            self.assertEqual(call().status_code, 204)
        sent.assert_called_once()
        self.assertEqual(len(published), 1)
        self.assertFalse(PushMessage.objects.exists())
        # If the continuation cannot be scheduled, QStash must retry the worker call itself.
        with mock.patch('notifications.push.kick'):
            push.notify(self.ana, title='x', body='y', url='/', tag='t')
        with mock.patch('notifications.push.http_post', unavailable), \
                mock.patch('notifications.push.urllib.request.urlopen', side_effect=TimeoutError('qstash down')):
            self.assertEqual(call().status_code, 503)


class DeadlineTests(PushTestCase):
    """The hand-off after a request stays within KICK_BUDGET, even with a cold FCM token."""

    def fcm_account(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        return {'project_id': 'pomak-test', 'client_email': 'push@pomak-test.iam.gserviceaccount.com',
                'private_key': key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                 serialization.NoEncryption()).decode()}

    def test_a_cold_fcm_token_service_that_hangs_does_not_hold_the_request(self):
        for i in range(4):
            PushDevice.objects.create(user=self.ana, kind='fcm', token=f'fcm-{i}')
        push._fcm_token.update(value=None, expires=0)

        def hang(request, timeout):  # the OAuth token service never answers
            time.sleep(timeout)
            raise TimeoutError('token service')

        with mock.patch.dict(os.environ, {'FCM_SERVICE_ACCOUNT': json.dumps(self.fcm_account())}):
            os.environ.pop('PUSH_WORKER_URL', None)
            with mock.patch('notifications.push.kick'):
                push.notify(self.ana, title='x', body='y', url='/', tag='t')
            with mock.patch('notifications.push.http_post', hang):
                started = time.monotonic()
                push.kick()
                elapsed = time.monotonic() - started
        self.assertLess(elapsed, push.KICK_BUDGET + 0.6)
        message = PushMessage.objects.get()
        self.assertEqual(len(message.devices), 4)  # all kept for a retry, none lost

    @override_settings(QSTASH_TOKEN='t', QSTASH_CURRENT_SIGNING_KEY='a', QSTASH_NEXT_SIGNING_KEY='b')
    def test_with_the_worker_a_request_never_calls_a_push_service(self):
        PushDevice.objects.create(user=self.ana, kind='fcm', token='fcm-x')

        def slow_qstash(request, timeout):
            time.sleep(timeout)
            raise TimeoutError('qstash')

        with mock.patch.dict(os.environ, {'FCM_SERVICE_ACCOUNT': json.dumps(self.fcm_account()),
                                          'PUSH_WORKER_URL': 'https://api.example.test/api/internal/push-deliver/'}):
            with mock.patch('notifications.push.kick'):
                push.notify(self.ana, title='x', body='y', url='/', tag='t')
            with mock.patch('notifications.push.urllib.request.urlopen', slow_qstash), \
                    mock.patch('notifications.push.http_post') as provider:
                started = time.monotonic()
                push.kick()
                elapsed = time.monotonic() - started
        provider.assert_not_called()
        self.assertLess(elapsed, push.KICK_BUDGET + 0.6)
        self.assertEqual(PushMessage.objects.count(), 1)  # still queued for the worker



class LegacyTransitionTests(PushTestCase):
    """Registrations from #75 (no attempt) and older apps keep working through the upgrade."""

    TOKEN = 'https://fcm.googleapis.com/fcm/send/legacy'

    def legacy_row(self, user=None):
        # What notifications.0002 leaves for a device registered under #75.
        return PushDevice.objects.create(user=user or self.ana, kind='web', token=self.TOKEN,
                                         p256dh=push.b64url(self.ua_public), auth=push.b64url(self.auth_secret))

    def logout(self, user, **body):
        self.as_user(user)
        return self.client.post('/api/auth/logout/', {'refresh': str(RefreshToken.for_user(user)), **body}, format='json')

    def test_an_older_app_registers_without_an_attempt_and_signs_out_by_token(self):
        self.as_user(self.ana)
        response = self.client.post('/api/push/devices/', {'kind': 'web', 'token': self.TOKEN, 'p256dh': push.b64url(self.ua_public),
                                                            'auth': push.b64url(self.auth_secret)}, format='json')
        self.assertEqual((response.status_code, response.data['attempt']), (201, None))
        self.assertIsNone(PushDevice.objects.get().attempt)  # marked legacy
        self.assertEqual(self.logout(self.ana, push_token=self.TOKEN).status_code, 204)
        self.assertFalse(PushDevice.objects.exists())

    def test_a_75_row_is_removed_by_the_legacy_logout_and_upgraded_by_a_new_registration(self):
        self.legacy_row()
        self.logout(self.ana, push_token=self.TOKEN)
        self.assertFalse(PushDevice.objects.exists())
        self.legacy_row()
        attempt = uuid4()
        self.as_user(self.ana)
        self.client.post('/api/push/devices/', {'kind': 'web', 'token': self.TOKEN, 'attempt': str(attempt),
                                                'p256dh': push.b64url(self.ua_public), 'auth': push.b64url(self.auth_secret)}, format='json')
        self.assertEqual(PushDevice.objects.get().attempt, attempt)  # same token, now with an attempt

    def test_a_legacy_removal_never_deletes_a_newer_registration_with_the_same_token(self):
        attempt = uuid4()
        PushDevice.objects.create(user=self.ana, kind='web', token=self.TOKEN, attempt=attempt,
                                  p256dh=push.b64url(self.ua_public), auth=push.b64url(self.auth_secret))
        self.logout(self.ana, push_token=self.TOKEN)  # a late logout of the old app
        self.as_user(self.ana)
        self.client.post('/api/push/devices/remove/', {'token': self.TOKEN}, format='json')  # an old app turning it off
        self.assertEqual(PushDevice.objects.get().attempt, attempt)

    def test_anonymous_revocations_are_bounded(self):
        from notifications.models import PushRevocation
        from notifications.views import DeviceRemoveView

        self.client.force_authenticate(user=None)
        response = self.client.post('/api/push/devices/remove/', {'attempt': str(uuid4()), 'user_id': str(uuid4())}, format='json')
        self.assertEqual(response.status_code, 200)  # an unknown account: nothing to do, no error
        self.assertFalse(PushRevocation.objects.exists())
        self.assertEqual(DeviceRemoveView.throttle_scope, 'push_revoke')


class LegacyOverwriteTests(PushTestCase):
    def test_a_late_legacy_registration_never_overwrites_a_newer_one(self):
        token = 'https://fcm.googleapis.com/fcm/send/same-device'
        attempt = uuid4()
        keys = {'p256dh': push.b64url(self.ua_public), 'auth': push.b64url(self.auth_secret)}
        self.as_user(self.ana)
        self.client.post('/api/push/devices/', {'kind': 'web', 'token': token, 'attempt': str(attempt), **keys}, format='json')
        before = PushDevice.objects.get()
        # A delayed request from the old version of the app (no attempt), same token, even as
        # another account: accepted, but it changes nothing.
        for user in (self.ana, self.coach):
            self.as_user(user)
            other_keys = {'p256dh': push.b64url(keypair()[1]), 'auth': push.b64url(os.urandom(16))}
            response = self.client.post('/api/push/devices/', {'kind': 'web', 'token': token, **other_keys}, format='json')
            self.assertEqual(response.status_code, 201)
        after = PushDevice.objects.get()
        self.assertEqual((after.attempt, after.user_id, after.p256dh, after.auth, after.updated_at),
                         (attempt, self.ana.pk, before.p256dh, before.auth, before.updated_at))
        # The newer registration is still revocable by its attempt.
        self.client.force_authenticate(user=None)
        self.client.post('/api/push/devices/remove/', {'attempt': str(attempt), 'user_id': str(self.ana.pk)}, format='json')
        self.assertFalse(PushDevice.objects.exists())

    def test_a_legacy_registration_still_updates_a_legacy_row(self):
        token = 'https://fcm.googleapis.com/fcm/send/old-only'
        keys = {'p256dh': push.b64url(self.ua_public), 'auth': push.b64url(self.auth_secret)}
        self.as_user(self.ana)
        self.client.post('/api/push/devices/', {'kind': 'web', 'token': token, **keys}, format='json')
        self.as_user(self.coach)
        self.client.post('/api/push/devices/', {'kind': 'web', 'token': token, **keys}, format='json')
        device = PushDevice.objects.get()
        self.assertEqual((device.user_id, device.attempt), (self.coach.pk, None))
