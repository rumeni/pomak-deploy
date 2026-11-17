from rest_framework.test import APITestCase

from accounts.models import User
from training import programs
from training.models import Exercise


class ProgramsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('prog@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)

    def get(self, **headers):
        res = self.client.get('/api/training/programs/', **headers)
        self.assertEqual(res.status_code, 200)
        return res.json()

    def test_every_exercise_of_every_program_is_in_the_shared_library(self):
        slugs = {item['slug'] for p in programs.PROGRAMS for r in p['routines'] for item in r['exercises']}
        library = set(Exercise.objects.filter(owner__isnull=True).values_list('slug', flat=True))
        self.assertEqual(slugs - library, set())
        # The new glute exercises have English names and instructions.
        for slug in ('glute-bridge', 'hip-abduction', 'cable-kickback', 'step-up', 'sumo-deadlift'):
            e = Exercise.objects.get(slug=slug)
            self.assertTrue(e.name_en and e.instructions and e.instructions_en, slug)

    def test_programs_are_routine_shaped_with_target_rpe_and_timed_sets(self):
        data = self.get()
        self.assertEqual(len(data), len(programs.PROGRAMS))
        beginner = next(p for p in data if p['key'] == 'full-body-beginner')
        bench = next(i for i in beginner['routines'][0]['exercises'] if i['exercise']['slug'] == 'bench-press')
        self.assertEqual(len(bench['sets']), 3)
        self.assertEqual(bench['sets'][0], {
            'set_type': 'working', 'reps_min': 8, 'reps_max': 10, 'weight_kg': None,
            'duration_seconds': None, 'distance_m': None, 'rpe': '6.5',
        })
        plank = next(i for i in beginner['routines'][0]['exercises'] if i['exercise']['slug'] == 'plank')
        self.assertEqual((plank['sets'][0]['reps_min'], plank['sets'][0]['duration_seconds'], plank['sets'][0]['rpe']), (None, 45, None))

    def test_the_profile_decides_what_is_recommended_first(self):
        profile = self.user.profile
        profile.sex, profile.training_experience = 'female', 'intermediate'
        profile.save()
        data = self.get()
        self.assertEqual(data[0]['key'], 'glutes-upper-quads-intermediate')
        self.assertTrue(data[0]['recommended'])
        self.assertEqual(sum(p['recommended'] for p in data), 1)
        # Same-sex programs come before the others, by level.
        self.assertEqual([p['sex'] for p in data[:3]], ['female'] * 3)

        profile.sex, profile.training_experience = '', ''  # not answered
        profile.save()
        self.assertEqual(self.get()[0]['key'], 'full-body-beginner')

    def test_names_follow_the_app_language(self):
        sr = self.get(HTTP_ACCEPT_LANGUAGE='sr-latn')
        en = self.get(HTTP_ACCEPT_LANGUAGE='en')
        self.assertIn('Celo telo', {p['key']: p for p in sr}['full-body-beginner']['name'])
        self.assertEqual({p['key']: p for p in en}['full-body-beginner']['name'], 'Full body for beginners')
