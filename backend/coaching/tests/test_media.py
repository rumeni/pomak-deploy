"""Pictures in conversations and the coach's profile picture (T3b)."""

from datetime import timedelta
from io import BytesIO
from unittest import mock
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APITestCase, APITransactionTestCase

from accounts.models import User
from coaching.media import delete_orphan_images
from coaching.models import CoachConnection, CoachMessage, CoachPhoto, MessageImage


def picture(size=(2400, 1800), fmt='JPEG', gps=True):
    image = Image.new('RGB', size, (200, 30, 30))
    out = BytesIO()
    if gps and fmt == 'JPEG':
        exif = Image.Exif()
        exif[0x010F] = 'PhoneMaker'  # camera make
        exif[0x8825] = {2: (44.0, 49.0, 0.0)}  # GPS latitude
        image.save(out, fmt, exif=exif)
    else:
        image.save(out, fmt)
    return SimpleUploadedFile(f'p.{fmt.lower()}', out.getvalue(), content_type=f'image/{fmt.lower()}')


class MediaTestCase(APITestCase):
    def setUp(self):
        self.coach = self.user('media-coach@example.test', coach=True)
        self.ana = self.user('media-ana@example.test')
        self.other = self.user('media-other@example.test')
        self.other_coach = self.user('media-other-coach@example.test', coach=True)
        self.connection = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.other_connection = CoachConnection.objects.create(coach=self.other_coach, client=self.other)

    def user(self, email, *, coach=False):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.save()
        return user

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def upload(self, user, file=None, **fields):
        self.as_user(user)
        return self.client.post('/api/coach/images/', {'file': file or picture(), **fields}, format='multipart')


class MessagePictureTests(MediaTestCase):
    def test_a_picture_is_re_encoded_small_and_without_metadata(self):
        response = self.upload(self.ana)
        self.assertEqual(response.status_code, 201)
        self.assertEqual((response.data['width'], response.data['height']), (1600, 1200))
        stored = Image.open(BytesIO(bytes(MessageImage.objects.get().data)))
        self.assertEqual(stored.format, 'JPEG')
        self.assertEqual(dict(stored.getexif()), {})
        self.assertNotIn(b'PhoneMaker', bytes(MessageImage.objects.get().data))

    def test_only_real_pictures_of_a_sane_size(self):
        bogus = SimpleUploadedFile('x.jpg', b'<svg onload=alert(1)>', content_type='image/jpeg')
        self.assertEqual(self.upload(self.ana, bogus).status_code, 400)
        huge = SimpleUploadedFile('x.jpg', b'0' * (4 * 1024 * 1024 + 1), content_type='image/jpeg')
        self.assertEqual(self.upload(self.ana, huge).status_code, 400)
        self.assertEqual(self.upload(self.ana, picture(fmt='PNG')).status_code, 201)
        self.as_user(self.ana)
        self.assertEqual(self.client.post('/api/coach/images/', {}, format='multipart').status_code, 400)

    def test_sent_with_a_message_and_seen_only_by_the_two_people(self):
        image_id = self.upload(self.ana).data['id']
        message_id = str(uuid4())
        response = self.client.post('/api/coach/messages/', {'id': message_id, 'text': '', 'image_id': image_id}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['image'], {'id': image_id})
        # A retry is the same message; the same ID with another picture is refused.
        self.assertEqual(self.client.post('/api/coach/messages/', {'id': message_id, 'text': '', 'image_id': image_id}, format='json').status_code, 200)
        other_image = self.upload(self.ana).data['id']
        self.assertEqual(self.client.post('/api/coach/messages/', {'id': message_id, 'text': '', 'image_id': other_image}, format='json').status_code, 400)
        url = f'/api/coach/images/{image_id}/'
        for user, status in ((self.ana, 200), (self.coach, 200), (self.other, 404), (self.other_coach, 404)):
            self.as_user(user)
            got = self.client.get(url)
            self.assertEqual(got.status_code, status, user.email)
        self.as_user(self.coach)
        got = self.client.get(url)
        self.assertEqual(got['Content-Type'], 'image/jpeg')
        self.assertEqual(got['Cache-Control'], 'no-store')
        # The archive keeps it readable for both.
        CoachConnection.objects.filter(pk=self.connection.pk).update(ended_at=timezone.now())
        self.assertEqual(self.client.get(url).status_code, 200)

    def test_a_picture_cannot_be_borrowed_or_reused(self):
        image_id = self.upload(self.ana).data['id']
        # Not yet sent: only the uploader can see it.
        self.as_user(self.coach)
        self.assertEqual(self.client.get(f'/api/coach/images/{image_id}/').status_code, 404)
        self.assertEqual(self.client.post('/api/coach/messages/', {'text': 'x', 'image_id': image_id, 'client_id': str(self.ana.pk)}, format='json').status_code, 400)
        self.as_user(self.ana)
        self.client.post('/api/coach/messages/', {'text': '', 'image_id': image_id}, format='json')
        self.assertEqual(self.client.post('/api/coach/messages/', {'text': '', 'image_id': image_id}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/coach/messages/', {'text': ''}, format='json').status_code, 400)
        foreign = self.upload(self.other).data['id']
        self.as_user(self.ana)
        self.assertEqual(self.client.post('/api/coach/messages/', {'text': '', 'image_id': foreign}, format='json').status_code, 400)

    def test_no_uploads_to_an_ended_collaboration_and_unsent_pictures_expire(self):
        image_id = self.upload(self.ana).data['id']
        MessageImage.objects.filter(pk=image_id).update(created_at=timezone.now() - timedelta(days=2))
        sent_id = self.upload(self.ana).data['id']
        self.client.post('/api/coach/messages/', {'text': '', 'image_id': sent_id}, format='json')
        CoachMessage.objects.filter(image_id=sent_id).update(created_at=timezone.now() - timedelta(days=2))
        MessageImage.objects.filter(pk=sent_id).update(created_at=timezone.now() - timedelta(days=2))
        self.assertEqual(delete_orphan_images(), 1)
        self.assertEqual(list(MessageImage.objects.values_list('pk', flat=True)), [MessageImage.objects.get(pk=sent_id).pk])
        CoachConnection.objects.filter(pk=self.connection.pk).update(ended_at=timezone.now())
        self.assertEqual(self.upload(self.ana, connection_id=str(self.connection.pk)).status_code, 409)


class CoachPhotoTests(MediaTestCase):
    def test_the_coach_sets_his_picture_and_clients_see_it_on_his_card(self):
        self.as_user(self.coach)
        response = self.client.put('/api/coach/profile/photo/', {'file': picture()}, format='multipart')
        self.assertEqual(response.status_code, 200)
        stored = Image.open(BytesIO(bytes(CoachPhoto.objects.get().data)))
        self.assertEqual(max(stored.size), 512)
        self.as_user(self.ana)
        card = self.client.get('/api/coach/dashboard/').data['coach']
        self.assertIsNotNone(card['photo'])
        self.assertEqual(self.client.get(f'/api/coach/photos/{self.coach.pk}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/coach/photos/{self.ana.pk}/').status_code, 404)
        # Only a coach has one.
        self.assertEqual(self.client.put('/api/coach/profile/photo/', {'file': picture()}, format='multipart').status_code, 403)
        self.as_user(self.coach)
        self.client.delete('/api/coach/profile/photo/')
        self.assertFalse(CoachPhoto.objects.exists())


class PictureRaceTests(MediaTestCase):
    def test_an_end_during_processing_stores_nothing(self):
        from coaching import views

        real = views.process_image

        def end_meanwhile(upload, side):
            result = real(upload, side)
            CoachConnection.objects.filter(pk=self.connection.pk).update(ended_at=timezone.now())
            return result

        with mock.patch('coaching.views.process_image', end_meanwhile):
            self.assertEqual(self.upload(self.ana).status_code, 409)
        self.assertFalse(MessageImage.objects.exists())

    def test_a_picture_sent_late_is_not_cleaned_up(self):
        image_id = self.upload(self.ana).data['id']
        MessageImage.objects.filter(pk=image_id).update(created_at=timezone.now() - timedelta(days=2))
        # Sent just before the cleanup runs (the cleanup re-checks under the same lock).
        self.client.post('/api/coach/messages/', {'text': '', 'image_id': image_id}, format='json')
        self.assertEqual(delete_orphan_images(), 0)
        self.assertTrue(MessageImage.objects.filter(pk=image_id).exists())

    def test_a_daily_byte_quota(self):
        from coaching import views

        with mock.patch.object(views, 'MAX_DAILY_IMAGE_BYTES', 1):
            self.assertEqual(self.upload(self.ana).status_code, 400)
        self.assertFalse(MessageImage.objects.exists())


class ParallelQuotaTests(APITransactionTestCase):
    """Two uploads of one person at the same moment: the daily quota still holds."""

    def test_parallel_uploads_cannot_both_pass_the_daily_limit(self):
        import threading

        from django.db import connections
        from rest_framework.test import APIClient

        from coaching import views

        coach = User.objects.create_user('pq-coach@example.test', 'a-strong-secret')
        coach.profile.is_coach = True
        coach.profile.save()
        ana = User.objects.create_user('pq-ana@example.test', 'a-strong-secret')
        CoachConnection.objects.create(coach=coach, client=ana)
        files = [picture(size=(400, 300)).read() for _ in range(2)]
        both_decoded = threading.Barrier(2, timeout=20)
        real = views.process_image
        results = []

        def decode_then_wait(upload, side):
            out = real(upload, side)
            both_decoded.wait()  # both requests reach the quota check together
            return out

        def upload(raw):
            try:
                client = APIClient()
                client.force_authenticate(user=ana)
                file = SimpleUploadedFile('p.jpg', raw, content_type='image/jpeg')
                results.append(client.post('/api/coach/images/', {'file': file}, format='multipart').status_code)
            finally:
                connections.close_all()

        with mock.patch.object(views, 'MAX_DAILY_IMAGES', 1), mock.patch('coaching.views.process_image', decode_then_wait):
            threads = [threading.Thread(target=upload, args=(raw,)) for raw in files]
            for t in threads:
                t.start()
            for t in threads:
                t.join(30)
        self.assertEqual(sorted(results), [201, 400])
        self.assertEqual(MessageImage.objects.count(), 1)

