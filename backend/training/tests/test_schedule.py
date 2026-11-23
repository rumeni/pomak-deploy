from rest_framework.test import APITestCase

from accounts.export import collect
from accounts.models import User
from training.models import Routine, ScheduleDay


class ScheduleTests(APITestCase):
    """The athlete's own week: weekday -> one of his routines; PUT replaces the whole week."""

    def setUp(self):
        self.user = User.objects.create_user('week@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.a = Routine.objects.create(owner=self.user, name='A')
        self.b = Routine.objects.create(owner=self.user, name='B')

    def put(self, days):
        return self.client.put('/api/training/schedule/', {'days': days}, format='json')

    def test_empty_week_then_saved_week(self):
        self.assertEqual(self.client.get('/api/training/schedule/').data, {'days': []})
        response = self.put([{'weekday': 3, 'routine_id': str(self.b.pk)}, {'weekday': 0, 'routine_id': str(self.a.pk)}])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['days'], [
            {'weekday': 0, 'routine_id': str(self.a.pk), 'name': 'A'},
            {'weekday': 3, 'routine_id': str(self.b.pk), 'name': 'B'},
        ])
        # Saving again replaces the week (a repeated request changes nothing).
        self.assertEqual(self.put([{'weekday': 0, 'routine_id': str(self.a.pk)}]).data['days'], [
            {'weekday': 0, 'routine_id': str(self.a.pk), 'name': 'A'},
        ])
        self.assertEqual(ScheduleDay.objects.filter(owner=self.user).count(), 1)
        self.assertEqual(self.put([]).data, {'days': []})

    def test_only_own_active_routines_one_per_day(self):
        other = User.objects.create_user('other@b.rs', 'jaka-lozinka-123')
        foreign = Routine.objects.create(owner=other, name='X')
        self.assertEqual(self.put([{'weekday': 1, 'routine_id': str(foreign.pk)}]).status_code, 400)
        self.a.archived_at = self.a.created_at
        self.a.save()
        self.assertEqual(self.put([{'weekday': 1, 'routine_id': str(self.a.pk)}]).status_code, 400)
        twice = [{'weekday': 2, 'routine_id': str(self.b.pk)}, {'weekday': 2, 'routine_id': str(self.b.pk)}]
        self.assertEqual(self.put(twice).status_code, 400)
        self.assertEqual(self.put([{'weekday': 7, 'routine_id': str(self.b.pk)}]).status_code, 400)
        self.assertEqual(self.client.put('/api/training/schedule/', [], format='json').status_code, 400)

    def test_a_deleted_routine_leaves_a_rest_day(self):
        self.put([{'weekday': 0, 'routine_id': str(self.a.pk)}, {'weekday': 2, 'routine_id': str(self.b.pk)}])
        self.assertEqual(self.client.delete(f'/api/training/routines/{self.a.pk}/').status_code, 204)
        self.assertEqual([d['weekday'] for d in self.client.get('/api/training/schedule/').data['days']], [2])

    def test_each_athlete_sees_only_his_week_and_it_is_exported(self):
        self.put([{'weekday': 4, 'routine_id': str(self.b.pk)}])
        other = User.objects.create_user('other2@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/training/schedule/').data, {'days': []})
        self.assertEqual(collect(self.user)['schedule'], [{'weekday': 4, 'routine': 'B'}])
