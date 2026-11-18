"""Push devices, Web Push encryption and VAPID, FCM, and what a notification may contain (T3b)."""

import json
import os
from unittest import mock
from urllib.error import HTTPError

import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import CoachConnection
from notifications import push
from notifications.models import PushDevice


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

    def subscribe(self, user, endpoint='https://push.example.test/sub/1'):
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
        self.client.post('/api/push/devices/remove/', {'token': 'https://push.example.test/sub/1'}, format='json')
        self.assertTrue(PushDevice.objects.exists())
        self.as_user(self.coach)
        self.client.post('/api/push/devices/remove/', {'token': 'https://push.example.test/sub/1'}, format='json')
        self.assertFalse(PushDevice.objects.exists())

    def test_invalid_subscriptions_are_refused_and_devices_are_capped(self):
        self.as_user(self.ana)
        self.assertEqual(self.client.post('/api/push/devices/', {'kind': 'web', 'token': 'http://x.test/1', 'p256dh': 'a', 'auth': 'b'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/push/devices/', {'kind': 'web', 'token': 'https://x.test/1'}, format='json').status_code, 400)
        for i in range(12):
            self.subscribe(self.ana, f'https://push.example.test/sub/{i}')
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
        with mock.patch('notifications.push.urllib.request.urlopen', fake_urlopen), self.captureOnCommitCallbacks(execute=True):
            self.client.post('/api/coach/messages/', {'text': 'Boli me koleno posle čučnja'}, format='json')
        self.assertEqual(len(sent), 1)
        request = sent[0]
        self.assertEqual(request.full_url, 'https://push.example.test/sub/1')
        self.assertEqual(request.headers['Content-encoding'], 'aes128gcm')
        token = request.headers['Authorization'].split('t=')[1].split(',')[0]
        claims = jwt.decode(token, VAPID_PRIVATE.public_key(), algorithms=['ES256'], audience='https://push.example.test')
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
        with mock.patch('notifications.push.urllib.request.urlopen', gone), self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post('/api/coach/messages/', {'text': 'Hej'}, format='json').status_code, 201)
        self.assertFalse(PushDevice.objects.exists())

    def test_nothing_is_sent_without_configuration_or_devices(self):
        with mock.patch('notifications.push.urllib.request.urlopen') as urlopen, self.captureOnCommitCallbacks(execute=True):
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
                mock.patch('notifications.push.urllib.request.urlopen', fake_urlopen), self.captureOnCommitCallbacks(execute=True):
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
