"""Two requests at the same time for one person: the second waits for the first, never a 500."""

import threading
from io import BytesIO
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connections
from django.test import TransactionTestCase
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from progress import photos
from progress.models import ProgressPhoto
from training.models import Routine, ScheduleDay


def run_together(*requests):
    """Runs each request in its own thread (own database connection); returns statuses or errors."""
    results = [None] * len(requests)

    def run(index, request):
        close_old_connections()
        try:
            results[index] = request()
        except Exception as error:  # an unhandled server error is a result too
            results[index] = error
        finally:
            connections.close_all()

    threads = [threading.Thread(target=run, args=(i, r)) for i, r in enumerate(requests)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)
    return results


class ConcurrentScheduleTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user('race-week@b.rs', 'jaka-lozinka-123')
        self.routine = Routine.objects.create(owner=self.user, name='A')

    def put(self):
        api = APIClient()
        api.force_authenticate(self.user)
        return api.put('/api/training/schedule/', {'days': [{'weekday': 0, 'routine_id': str(self.routine.pk)}]}, format='json').status_code

    def test_two_saves_of_an_empty_week_at_once(self):
        # Both requests reach the replacement before either writes (the first waits after its
        # delete until the second has had its chance): with no per-person lock both would insert
        # Monday and the second would fail on the one-routine-per-day constraint.
        first_deleted = threading.Event()
        original = ScheduleDay.objects.bulk_create
        calls = []

        def slow_bulk_create(objs, *args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                first_deleted.set()
                threading.Event().wait(0.8)
            return original(objs, *args, **kwargs)

        with mock.patch.object(ScheduleDay.objects, 'bulk_create', side_effect=slow_bulk_create):
            results = run_together(self.put, lambda: (first_deleted.wait(5), self.put())[1])
        self.assertEqual(results, [200, 200])
        self.assertEqual(list(ScheduleDay.objects.filter(owner=self.user).values_list('weekday', flat=True)), [0])


def picture():
    out = BytesIO()
    Image.new('RGB', (64, 48), (10, 120, 60)).save(out, 'JPEG')
    return out.getvalue()


class ConcurrentPhotoRetryTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user('race-photo@b.rs', 'jaka-lozinka-123')
        self.photo_id = '4f2d0c64-3a51-4b6e-9a3d-0d6c1b1a2e11'
        self.content = picture()

    def upload(self):
        api = APIClient()
        api.force_authenticate(self.user)
        body = {
            'id': self.photo_id, 'taken_on': timezone.localdate().isoformat(), 'pose': 'front',
            'file': SimpleUploadedFile('p.jpg', self.content, content_type='image/jpeg'),
        }
        return api.post('/api/progress/photos/', body, format='multipart').status_code

    def test_a_retry_at_the_same_time_as_its_first_attempt_is_stored_once(self):
        # Both attempts pass the early "already stored?" check before either inserts.
        both_decoding = threading.Barrier(2, timeout=5)
        original = photos.process_image

        def decode_together(upload, side):
            both_decoding.wait()
            return original(upload, side)

        with mock.patch.object(photos, 'process_image', side_effect=decode_together):
            results = run_together(self.upload, self.upload)
        self.assertEqual(sorted(results), [200, 201])
        self.assertEqual(ProgressPhoto.objects.filter(pk=self.photo_id).count(), 1)
