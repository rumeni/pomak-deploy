import uuid
import zipfile
from datetime import timedelta
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APITestCase

from accounts.export import build_zip, collect
from accounts.models import User
from coaching.models import CoachConnection
from progress.models import ProgressPhoto


def picture(color=(200, 30, 30), size=(2400, 1800)):
    out = BytesIO()
    image = Image.new('RGB', size, color)
    exif = Image.Exif()
    exif[0x010F] = 'SecretCam'  # camera make: must not survive
    image.save(out, 'JPEG', exif=exif)
    return SimpleUploadedFile('p.jpg', out.getvalue(), content_type='image/jpeg')


class ProgressPhotoTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('photo@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate()

    def upload(self, **extra):
        body = {'file': picture(), 'taken_on': self.today.isoformat(), 'pose': 'side', **extra}
        return self.client.post('/api/progress/photos/', body, format='multipart')

    def test_upload_list_image_delete(self):
        response = self.upload(note='Posle 8 nedelja')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data['pose'], response.data['note']), ('side', 'Posle 8 nedelja'))
        # Shrunk to at most 1280 px and re-encoded without metadata.
        self.assertEqual(max(response.data['width'], response.data['height']), 1280)
        listed = self.client.get('/api/progress/photos/').data
        self.assertEqual([p['id'] for p in listed], [response.data['id']])
        image = self.client.get(f"/api/progress/photos/{response.data['id']}/image/")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image['Content-Type'], 'image/jpeg')
        self.assertEqual(image['Cache-Control'], 'no-store')
        stored = Image.open(BytesIO(image.content))
        self.assertNotIn(0x010F, stored.getexif())
        self.assertEqual(self.client.delete(f"/api/progress/photos/{response.data['id']}/").status_code, 204)
        self.assertEqual(self.client.get('/api/progress/photos/').data, [])

    def test_a_retried_upload_is_stored_once(self):
        photo_id = str(uuid.uuid4())
        self.assertEqual(self.upload(id=photo_id).status_code, 201)
        self.assertEqual(self.upload(id=photo_id).status_code, 200)
        self.assertEqual(ProgressPhoto.objects.count(), 1)

    def test_refuses_future_dates_and_files_that_are_not_pictures(self):
        tomorrow = (self.today + timedelta(days=1)).isoformat()
        self.assertEqual(self.upload(taken_on=tomorrow).status_code, 400)
        fake = SimpleUploadedFile('x.jpg', b'not a picture', content_type='image/jpeg')
        self.assertEqual(self.upload(file=fake).status_code, 400)
        self.assertEqual(ProgressPhoto.objects.count(), 0)

    def test_daily_limit(self):
        for _ in range(20):
            ProgressPhoto.objects.create(user=self.user, taken_on=self.today, data=b'x', width=1, height=1)
        self.assertEqual(self.upload().status_code, 400)

    def test_nobody_else_sees_them(self):
        photo_id = self.upload().data['id']
        other = User.objects.create_user('other@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/progress/photos/').data, [])
        self.assertEqual(self.client.get(f'/api/progress/photos/{photo_id}/image/').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/progress/photos/{photo_id}/').status_code, 404)
        # Taking someone else's ID is refused, not an overwrite.
        self.assertEqual(self.upload(id=photo_id).status_code, 400)

    def test_coach_sees_them_only_while_measurements_are_shared(self):
        photo_id = self.upload().data['id']
        coach = User.objects.create_user('coach@b.rs', 'jaka-lozinka-123')
        coach.profile.is_coach = True
        coach.profile.save()
        connection = CoachConnection.objects.create(coach=coach, client=self.user, share_measurements=False)
        self.client.force_authenticate(coach)
        base = f'/api/coach/clients/{self.user.pk}/photos/'
        self.assertIsNone(self.client.get(base).data)
        self.assertEqual(self.client.get(f'{base}{photo_id}/image/').status_code, 404)
        connection.share_measurements = True
        connection.save()
        self.assertEqual([p['id'] for p in self.client.get(base).data], [photo_id])
        self.assertEqual(self.client.get(f'{base}{photo_id}/image/').status_code, 200)
        # After the collaboration ends: nothing.
        connection.ended_at = timezone.now()
        connection.save()
        self.assertEqual(self.client.get(base).status_code, 404)

    def test_export_has_the_pictures(self):
        self.upload()
        self.assertEqual(len(collect(self.user)['progress_photos']), 1)
        names = zipfile.ZipFile(BytesIO(build_zip(self.user))).namelist()
        self.assertEqual(len([n for n in names if n.startswith('slike_napretka/')]), 1)
