from rest_framework.test import APITestCase

from accounts.export import PROFILE_FIELDS
from accounts.models import User


class BmiCategoryPreferenceTests(APITestCase):
    """BMI is always shown as a number; its category only after the user opts in."""

    def setUp(self):
        self.user = User.objects.create_user('bmi@example.com', 'safe-pass-123')
        self.client.force_authenticate(self.user)

    def test_category_is_off_by_default(self):
        res = self.client.get('/api/auth/me/')
        self.assertEqual(res.status_code, 200)
        self.assertIs(res.data['profile']['show_bmi_category'], False)

    def test_user_can_turn_the_category_on_and_off(self):
        res = self.client.patch('/api/auth/me/', {'profile': {'show_bmi_category': True}}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertIs(res.data['profile']['show_bmi_category'], True)
        self.user.profile.refresh_from_db()
        self.assertTrue(self.user.profile.show_bmi_category)

        res = self.client.patch('/api/auth/me/', {'profile': {'show_bmi_category': False}}, format='json')
        self.assertIs(res.data['profile']['show_bmi_category'], False)

    def test_preference_is_part_of_the_data_export(self):
        self.assertIn('show_bmi_category', PROFILE_FIELDS)
