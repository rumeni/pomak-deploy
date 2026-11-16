import datetime
import uuid

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from progress.models import Measurement


class MeasurementTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def test_resending_same_id_does_not_duplicate(self):
        payload = {'id': str(uuid.uuid4()), 'kind': 'weight', 'value': '82.40', 'measured_on': '2026-09-24'}
        first = self.client.post('/api/progress/measurements/', payload)
        second = self.client.post('/api/progress/measurements/', payload)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(Measurement.objects.count(), 1)
        self.assertEqual(first.data['unit'], 'kg')

    def test_retry_changed_post_updates_value_and_date_without_duplicates(self):
        mid = str(uuid.uuid4())
        original = {'id': mid, 'kind': 'weight', 'value': '82.4', 'measured_on': '2026-09-24'}
        self.assertEqual(self.client.post('/api/progress/measurements/', original).status_code, 201)
        self.assertEqual(self.client.post('/api/progress/measurements/', original).status_code, 200)
        changed = {**original, 'value': '81.2', 'measured_on': '2026-09-25'}
        response = self.client.post('/api/progress/measurements/', changed)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['value'], '81.20')
        self.assertEqual(response.data['measured_on'], '2026-09-25')
        self.assertEqual(Measurement.objects.count(), 1)

        invalid = {**changed, 'value': '785'}
        self.assertEqual(self.client.post('/api/progress/measurements/', invalid).status_code, 400)
        self.assertEqual(str(Measurement.objects.get(pk=mid).value), '81.20')

    def test_other_users_id_is_rejected(self):
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        m = Measurement.objects.create(user=other, kind='weight', value=70, measured_on='2026-09-24')
        res = self.client.post('/api/progress/measurements/', {
            'id': str(m.id), 'kind': 'weight', 'value': '80', 'measured_on': '2026-09-24',
        })
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Measurement.objects.get(pk=m.pk).value, 70)

    def test_only_own_measurements_listed(self):
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        Measurement.objects.create(user=other, kind='weight', value=70, measured_on='2026-09-24')
        Measurement.objects.create(user=self.user, kind='weight', value=80, measured_on='2026-09-24')
        res = self.client.get('/api/progress/measurements/')
        self.assertEqual(len(res.data), 1)

    def test_unrealistic_weight_rejected(self):
        res = self.client.post('/api/progress/measurements/', {'kind': 'weight', 'value': '785', 'measured_on': '2026-09-24'})
        self.assertEqual(res.status_code, 400)

    def test_future_date_rejected(self):
        future = (timezone.localdate() + datetime.timedelta(days=3)).isoformat()
        res = self.client.post('/api/progress/measurements/', {'kind': 'weight', 'value': '80', 'measured_on': future})
        self.assertEqual(res.status_code, 400)
        self.assertIn('measured_on', res.data)

    def test_patch_cannot_rekey_owned_measurement_to_another_users_uuid(self):
        other = User.objects.create_user('other@example.test', 'jaka-lozinka-123')
        own = Measurement.objects.create(
            user=self.user, kind='weight', value=80, measured_on='2026-09-24',
        )
        victim = Measurement.objects.create(
            user=other, kind='weight', value=70, measured_on='2026-09-24',
        )
        result = self.client.patch(
            f'/api/progress/measurements/{own.pk}/',
            {'id': str(victim.pk), 'value': '81'},
            format='json',
        )
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['id'], str(own.pk))
        own.refresh_from_db()
        victim.refresh_from_db()
        self.assertEqual(own.user_id, self.user.pk)
        self.assertEqual(own.value, 81)
        self.assertEqual(victim.user_id, other.pk)
        self.assertEqual(victim.value, 70)
        self.assertEqual(Measurement.objects.count(), 2)
