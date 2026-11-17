from django.test import TestCase

from accounts.models import User
from accounts.serializers import MeSerializer


class ConcurrentProfilePatchesTests(TestCase):
    def test_disjoint_stale_profile_patches_do_not_revert_each_other(self):
        user = User.objects.create_user('race@example.com', 'safe-pass-123')
        first = User.objects.select_related('profile').get(pk=user.pk)
        second = User.objects.select_related('profile').get(pk=user.pk)

        language = MeSerializer(first, data={'profile': {'language': 'en'}}, partial=True)
        self.assertTrue(language.is_valid(), language.errors)
        language.save()

        tracking = MeSerializer(second, data={'profile': {'tracks_training': False}}, partial=True)
        self.assertTrue(tracking.is_valid(), tracking.errors)
        tracking.save()

        user.profile.refresh_from_db()
        self.assertEqual(user.profile.language, 'en')
        self.assertFalse(user.profile.tracks_training)

    def test_empty_patch_does_not_rewrite_stale_profile(self):
        user = User.objects.create_user('noop@example.com', 'safe-pass-123')
        old = User.objects.select_related('profile').get(pk=user.pk)
        user.profile.language = 'en'
        user.profile.save(update_fields=['language'])
        patch = MeSerializer(old, data={}, partial=True)
        self.assertTrue(patch.is_valid(), patch.errors)
        patch.save()
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.language, 'en')
