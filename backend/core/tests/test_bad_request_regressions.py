"""Malformed but authenticated requests should return 400, not server errors."""

from rest_framework.test import APITestCase

from accounts.models import User


class BadRequestRegressions(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('bad-body@example.test', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def test_non_object_json_is_bad_request_not_500(self):
        for method, path in (
            ('post', '/api/training/routines/'),
            ('post', '/api/progress/measurements/'),
            ('post', '/api/auth/logout/'),
            ('post', '/api/auth/refresh/'),
            ('post', '/api/nutrition/targets/estimate/'),
        ):
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path, [], format='json')
                self.assertEqual(response.status_code, 400, response.data)

    def test_week_at_end_of_year_9999_returns_400(self):
        response = self.client.get('/api/progress/week/', {'start': '9999-12-31'})
        self.assertEqual(response.status_code, 400, response.data)

    def test_non_string_valid_from_returns_400(self):
        response = self.client.post(
            '/api/nutrition/targets/estimate/',
            {'valid_from': {'unexpected': 'date'}, 'activity': 'moderate', 'goal': 'maintain', 'pace': 0, 'special_conditions': False},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
