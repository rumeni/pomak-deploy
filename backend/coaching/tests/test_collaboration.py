from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import CoachAssignment, CoachConnection, CoachInvitation, CoachMessage
from nutrition.models import MealEntry
from progress.models import Measurement
from training.models import Exercise, Routine, RoutineExercise, RoutineSet, SessionExercise, SetLog, WorkoutSession


class CoachCollaborationTests(APITestCase):
    def setUp(self):
        self.coach = User.objects.create_user('coach@example.test', 'a-strong-secret')
        self.coach.profile.is_coach = True
        self.coach.profile.display_name = 'Coach M'
        self.coach.profile.save()
        self.another_coach = User.objects.create_user('other-coach@example.test', 'a-strong-secret')
        self.another_coach.profile.is_coach = True
        self.another_coach.profile.save()
        self.client_user = User.objects.create_user('client@example.test', 'a-strong-secret')
        self.other_client = User.objects.create_user('other-client@example.test', 'a-strong-secret')

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def invite(self):
        self.as_user(self.coach)
        response = self.client.post('/api/coach/invitations/', {}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def connect(self, *, measurements=False, nutrition=False, user=None):
        code = self.invite()['code']
        self.as_user(user or self.client_user)
        response = self.client.post('/api/coach/connect/', {
            'code': code, 'share_measurements': measurements, 'share_nutrition': nutrition,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response

    def test_requires_authentication_and_coach_role_for_invites(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get('/api/coach/dashboard/').status_code, 401)
        self.as_user(self.client_user)
        self.assertEqual(self.client.post('/api/coach/invitations/', {}, format='json').status_code, 403)
        self.assertEqual(self.client.get('/api/coach/dashboard/').data['role'], 'client')
        self.as_user(self.coach)
        self.assertEqual(self.client.get('/api/coach/dashboard/').data['role'], 'coach')

    def test_consent_is_explicit_and_invite_one_time(self):
        code = self.invite()['code']
        self.as_user(self.client_user)
        accepted = self.client.post('/api/coach/connect/', {'code': code}, format='json')
        self.assertEqual(accepted.status_code, 201, accepted.data)
        self.assertFalse(accepted.data['share_measurements'])
        self.assertFalse(accepted.data['share_nutrition'])
        self.assertEqual(accepted.data['coach']['name'], 'Coach M')
        self.as_user(self.other_client)
        self.assertEqual(self.client.post('/api/coach/connect/', {'code': code}, format='json').status_code, 400)
        self.assertEqual(CoachConnection.objects.count(), 1)
        self.assertIsNotNone(CoachInvitation.objects.get(code=code).redeemed_at)

    def test_expiry_revocation_and_invite_limit(self):
        expired = CoachInvitation.objects.create(coach=self.coach, expires_at=timezone.now() - timedelta(seconds=2))
        self.as_user(self.client_user)
        self.assertEqual(self.client.post('/api/coach/connect/', {'code': expired.code}, format='json').status_code, 400)
        valid = self.invite()
        self.as_user(self.coach)
        self.assertEqual(self.client.delete(f'/api/coach/invitations/{valid["id"]}/').status_code, 204)
        self.as_user(self.client_user)
        self.assertEqual(self.client.post('/api/coach/connect/', {'code': valid['code']}, format='json').status_code, 400)
        for _ in range(5):
            self.invite()
        self.as_user(self.coach)
        self.assertEqual(self.client.post('/api/coach/invitations/', {}, format='json').status_code, 400)

    def test_coach_cannot_connect_as_client_or_client_have_two_coaches(self):
        code = self.invite()['code']
        self.as_user(self.another_coach)
        self.assertEqual(self.client.post('/api/coach/connect/', {'code': code}, format='json').status_code, 403)
        self.connect()
        second_code = self.invite()['code']
        self.as_user(self.client_user)
        self.assertEqual(self.client.post('/api/coach/connect/', {'code': second_code}, format='json').status_code, 400)

    def test_coach_can_only_see_consented_information(self):
        self.connect()
        now = timezone.now()
        WorkoutSession.objects.create(owner=self.client_user, name='Monday workout', started_at=now - timedelta(hours=1), finished_at=now)
        Measurement.objects.create(user=self.client_user, kind=Measurement.Kind.WEIGHT, value='74.20', measured_on=timezone.localdate())
        MealEntry.objects.create(owner=self.client_user, date=timezone.localdate(), meal='lunch', name='Private lunch', kcal='500.0')
        self.as_user(self.coach)
        response = self.client.get(f'/api/coach/clients/{self.client_user.pk}/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['workouts_30d'], 1)
        self.assertEqual(response.data['recent_workouts'][0]['name'], 'Monday workout')
        self.assertIsNone(response.data['measurements'])
        self.assertIsNone(response.data['nutrition_days'])
        self.as_user(self.client_user)
        self.assertEqual(self.client.patch('/api/coach/connection/', {'share_nutrition': True}, format='json').status_code, 200)
        self.as_user(self.coach)
        response = self.client.get(f'/api/coach/clients/{self.client_user.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['measurements'])
        self.assertEqual(response.data['nutrition_days'][0]['kcal'], '500.0')
        self.as_user(self.client_user)
        self.assertEqual(self.client.patch('/api/coach/connection/', {'share_measurements': True, 'share_nutrition': False}, format='json').status_code, 200)
        self.as_user(self.coach)
        response = self.client.get(f'/api/coach/clients/{self.client_user.pk}/')
        self.assertEqual(response.data['measurements'][0]['value'], '74.20')
        self.assertIsNone(response.data['nutrition_days'])

    def test_foreign_coach_cannot_view_message_assign_or_remove_client(self):
        self.connect()
        self.as_user(self.another_coach)
        target = f'/api/coach/clients/{self.client_user.pk}/'
        self.assertEqual(self.client.get(target).status_code, 404)
        self.assertEqual(self.client.delete(target).status_code, 404)
        self.assertEqual(self.client.post(target + 'assign/', {'routine_id': str(self.coach.pk)}, format='json').status_code, 404)
        self.assertEqual(self.client.get('/api/coach/messages/', {'client_id': str(self.client_user.pk)}).status_code, 404)
        self.assertEqual(self.client.post('/api/coach/messages/', {'client_id': str(self.client_user.pk), 'text': 'test'}, format='json').status_code, 404)

    def test_warmup_sets_are_labeled_in_client_workout_summary(self):
        self.connect()
        shared = Exercise.objects.create(
            owner=None, slug='coach-sets-exercise', name='Squat', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.LEGS,
        )
        now = timezone.now()
        workout = WorkoutSession.objects.create(
            owner=self.client_user, name='Strength', started_at=now - timedelta(hours=2), finished_at=now,
        )
        item = SessionExercise.objects.create(session=workout, exercise=shared, position=0)
        SetLog.objects.create(session_exercise=item, position=0, set_type=RoutineSet.SetType.WARMUP, reps=12)
        SetLog.objects.create(session_exercise=item, position=1, set_type=RoutineSet.SetType.WORKING, reps=8, weight_kg='60')
        self.as_user(self.coach)
        response = self.client.get(f'/api/coach/clients/{self.client_user.pk}/')
        self.assertEqual(response.status_code, 200, response.data)
        sets = response.data['recent_workouts'][0]['exercises'][0]['sets']
        self.assertEqual([s['set_type'] for s in sets], ['warmup', 'working'])
        self.assertEqual(sets[1]['weight_kg'], '60.00')

    def test_assigns_independent_copy_of_shared_routine(self):
        self.connect()
        source = Routine.objects.create(owner=self.coach, name='Strength A', notes='Slow tempo')
        shared = Exercise.objects.create(
            owner=None, slug='coach-shared-exercise', name='Plank', equipment=Exercise.Equipment.BODYWEIGHT,
            measurement=Exercise.Measurement.DURATION, muscle=Exercise.Muscle.CORE,
        )
        row = RoutineExercise.objects.create(routine=source, exercise=shared, position=0, rest_seconds=90)
        RoutineSet.objects.create(routine_exercise=row, position=0, duration_seconds=30)
        self.as_user(self.coach)
        assigned = self.client.post(f'/api/coach/clients/{self.client_user.pk}/assign/', {'routine_id': str(source.pk)}, format='json')
        self.assertEqual(assigned.status_code, 201, assigned.data)
        clone = Routine.objects.get(pk=assigned.data['routine_id'])
        self.assertNotEqual(clone.pk, source.pk)
        self.assertEqual(clone.owner, self.client_user)
        self.assertEqual(clone.exercises.get().sets.get().duration_seconds, 30)
        self.assertEqual(CoachAssignment.objects.count(), 1)
        self.as_user(self.client_user)
        self.assertTrue(any(str(x['id']) == str(clone.pk) for x in self.client.get('/api/training/routines/').data))
        self.assertEqual(len(self.client.get('/api/coach/dashboard/').data['assignments']), 1)
        self.assertEqual(self.client.delete('/api/coach/connection/').status_code, 204)
        self.assertTrue(Routine.objects.filter(pk=clone.pk, owner=self.client_user).exists())
        self.assertEqual(CoachAssignment.objects.count(), 0)

    def test_private_coach_exercise_cannot_be_assigned(self):
        self.connect()
        source = Routine.objects.create(owner=self.coach, name='Private')
        private = Exercise.objects.create(
            owner=self.coach, name='Coach secret', equipment=Exercise.Equipment.OTHER,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.FULL_BODY,
        )
        row = RoutineExercise.objects.create(routine=source, exercise=private, position=0)
        RoutineSet.objects.create(routine_exercise=row, position=0, reps_min=10)
        self.as_user(self.coach)
        res = self.client.post(f'/api/coach/clients/{self.client_user.pk}/assign/', {'routine_id': str(source.pk)}, format='json')
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(Routine.objects.filter(owner=self.client_user).count(), 0)

    def test_messages_are_private_and_disappears_on_disconnect(self):
        self.connect()
        self.as_user(self.coach)
        url = '/api/coach/messages/'
        self.assertEqual(self.client.post(url, {'text': 'Hello', 'client_id': str(self.client_user.pk)}, format='json').status_code, 201)
        self.assertEqual(self.client.post(url, {'text': ' ' * 5, 'client_id': str(self.client_user.pk)}, format='json').status_code, 400)
        self.as_user(self.client_user)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]['text'], 'Hello')
        self.assertEqual(self.client.post(url, {'text': 'Ready'}, format='json').status_code, 201)
        self.assertEqual(CoachMessage.objects.count(), 2)
        self.assertEqual(self.client.delete('/api/coach/connection/').status_code, 204)
        self.assertEqual(CoachMessage.objects.count(), 0)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.as_user(self.coach)
        self.assertEqual(self.client.get(url, {'client_id': str(self.client_user.pk)}).status_code, 404)

    def test_message_history_cursor_loads_all_messages_with_new_messages_arriving(self):
        self.connect()
        connection = CoachConnection.objects.get(client=self.client_user)
        base = timezone.now() - timedelta(days=1)
        for i in range(86):
            msg = CoachMessage.objects.create(connection=connection, sender=self.coach, text=f'Message {i}')
            CoachMessage.objects.filter(pk=msg.pk).update(created_at=base + timedelta(seconds=i))
        url = '/api/coach/messages/'
        self.as_user(self.coach)
        params = {'client_id': str(self.client_user.pk)}
        first = self.client.get(url, params)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.data), 80)
        self.assertEqual(first.data[0]['text'], 'Message 6')
        cursor = {
            **params, 'before': first.data[0]['created_at'], 'before_id': first.data[0]['id'],
        }
        CoachMessage.objects.create(connection=connection, sender=self.client_user, text='Just arrived')
        second = self.client.get(url, cursor)
        self.assertEqual(second.status_code, 200)
        self.assertEqual([m['text'] for m in second.data], [f'Message {i}' for i in range(6)])
        self.assertFalse({m['id'] for m in first.data} & {m['id'] for m in second.data})
        self.assertEqual(len({m['id'] for m in first.data + second.data}), 86)

        self.as_user(self.client_user)
        # Client can retrieve their own history, including older messages.
        self.assertEqual(len(self.client.get(url, cursor).data), 6)
        self.as_user(self.another_coach)
        self.assertEqual(self.client.get(url, cursor).status_code, 404)

    def test_message_history_cursor_handles_equal_timestamps_and_rejects_invalid_input(self):
        self.connect()
        connection = CoachConnection.objects.get(client=self.client_user)
        base = timezone.now() - timedelta(days=1)
        for i in range(83):
            msg = CoachMessage.objects.create(connection=connection, sender=self.client_user, text=f'Message {i}')
            CoachMessage.objects.filter(pk=msg.pk).update(created_at=base)
        self.as_user(self.client_user)
        url = '/api/coach/messages/'
        first = self.client.get(url)
        self.assertEqual(len(first.data), 80)
        cursor = {'before': first.data[0]['created_at'], 'before_id': first.data[0]['id']}
        older = self.client.get(url, cursor)
        self.assertEqual(older.status_code, 200)
        self.assertEqual(len(older.data), 3)
        self.assertEqual(len({m['id'] for m in first.data + older.data}), 83)

        for bad in (
            {'before': cursor['before']},
            {'before_id': cursor['before_id']},
            {'before': 'bad', 'before_id': cursor['before_id']},
            {'before': cursor['before'], 'before_id': 'not-a-uuid'},
            {'before': base.isoformat().replace('+00:00', ''), 'before_id': cursor['before_id']},
        ):
            with self.subTest(bad=bad):
                self.assertEqual(self.client.get(url, bad).status_code, 400)

    def test_coach_message_json_shape_is_validated_before_lookup(self):
        self.connect()
        self.as_user(self.coach)
        url = '/api/coach/messages/'
        for raw in ('[]', '"text"', 'null'):
            with self.subTest(raw=raw):
                invalid = self.client.post(url, data=raw, content_type='application/json')
                self.assertEqual(invalid.status_code, 400, invalid.content)
                self.assertIn('detail', invalid.data)
                invalid_with_query = self.client.post(
                    url + '?client_id=' + str(self.client_user.pk),
                    data=raw, content_type='application/json',
                )
                self.assertEqual(invalid_with_query.status_code, 400, invalid_with_query.content)
        self.assertEqual(CoachMessage.objects.count(), 0)
        valid = self.client.post(url, {'client_id': str(self.client_user.pk), 'text': 'Hi'}, format='json')
        self.assertEqual(valid.status_code, 201, valid.data)

    def test_invite_and_connection_not_cross_manageable(self):
        invite = self.invite()
        self.as_user(self.another_coach)
        self.assertEqual(self.client.delete(f'/api/coach/invitations/{invite["id"]}/').status_code, 404)
        self.as_user(self.client_user)
        self.assertEqual(self.client.delete(f'/api/coach/invitations/{invite["id"]}/').status_code, 403)
        self.assertEqual(self.client.patch('/api/coach/connection/', {'share_nutrition': True}, format='json').status_code, 404)
        self.assertEqual(self.client.post('/api/coach/connect/', {'code': 'not-real'}, format='json').status_code, 400)