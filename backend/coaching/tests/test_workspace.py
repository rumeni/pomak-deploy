"""Coach workspace (T1): profile, invitation preview, tasks, notes, client status and archive."""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import CoachConnection, CoachNote, CoachTask
from training.models import Exercise, RoutineSet, SessionExercise, SetLog, WorkoutSession


class WorkspaceTestCase(APITestCase):
    def setUp(self):
        self.coach = self.user('coach@example.test', coach=True, name='Coach M')
        self.other_coach = self.user('other-coach@example.test', coach=True)
        self.athlete = self.user('athlete@example.test', name='Ana')
        self.stranger = self.user('stranger@example.test')
        self.bench = Exercise.objects.create(
            owner=None, slug='ws-bench', name='Bench', name_en='Bench press', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST,
        )

    def user(self, email, *, coach=False, name=''):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.display_name = name
        user.profile.save()
        return user

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def connect(self, athlete=None, coach=None, *, days_ago=0):
        connection = CoachConnection.objects.create(coach=coach or self.coach, client=athlete or self.athlete)
        if days_ago:
            moment = timezone.now() - timedelta(days=days_ago)
            CoachConnection.objects.filter(pk=connection.pk).update(created_at=moment, active_since=moment)
            connection.refresh_from_db()
        return connection

    def workout(self, *, hours_ago=1, weight=None, reps=5, **readiness):
        start = timezone.now() - timedelta(hours=hours_ago)
        session = WorkoutSession.objects.create(
            owner=self.athlete, name='Upper A', started_at=start, finished_at=start + timedelta(minutes=50), **readiness,
        )
        if weight is not None:
            item = SessionExercise.objects.create(session=session, exercise=self.bench, position=0)
            SetLog.objects.create(session_exercise=item, position=0, set_type=RoutineSet.SetType.WORKING, reps=reps, weight_kg=weight)
        return session

    def tasks(self, user=None):
        self.as_user(user or self.coach)
        response = self.client.get('/api/coach/tasks/')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data


class CoachProfileTests(WorkspaceTestCase):
    def test_starting_questions_are_required_once_and_kept(self):
        self.as_user(self.coach)
        self.assertIsNone(self.client.get('/api/coach/profile/').data['completed_at'])
        incomplete = self.client.put('/api/coach/profile/', {'complete': True, 'work_mode': 'in_person'}, format='json')
        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(set(incomplete.data), {'years_experience', 'specialties', 'city'})
        done = self.client.put('/api/coach/profile/', {
            'complete': True, 'years_experience': 6, 'specialties': ['strength', 'strength', 'beginners'],
            'work_mode': 'both', 'city': 'Novi Sad', 'gym_name': 'Teretana X', 'qualifications': 'Licenca FTS',
        }, format='json')
        self.assertEqual(done.status_code, 200, done.data)
        self.assertIsNotNone(done.data['completed_at'])
        self.assertEqual(done.data['specialties'], ['strength', 'beginners'])
        # Once completed, the answers cannot be emptied again.
        self.assertEqual(self.client.put('/api/coach/profile/', {'specialties': []}, format='json').status_code, 400)
        self.assertTrue(self.client.get('/api/coach/dashboard/').data['profile_completed'])

    def test_online_coach_needs_no_city_and_unknown_specialty_is_refused(self):
        self.as_user(self.coach)
        body = {'complete': True, 'years_experience': 2, 'specialties': ['mobility'], 'work_mode': 'online'}
        self.assertEqual(self.client.put('/api/coach/profile/', body, format='json').status_code, 200)
        self.assertEqual(self.client.put('/api/coach/profile/', {'specialties': ['magic']}, format='json').status_code, 400)

    def test_only_coaches_have_a_coach_profile(self):
        self.as_user(self.athlete)
        self.assertEqual(self.client.get('/api/coach/profile/').status_code, 403)
        self.assertEqual(self.client.put('/api/coach/profile/', {'bio': 'x'}, format='json').status_code, 403)


class InvitationPreviewTests(WorkspaceTestCase):
    def test_client_sees_who_the_coach_is_before_accepting_and_never_the_email(self):
        self.as_user(self.coach)
        self.client.put('/api/coach/profile/', {
            'complete': True, 'years_experience': 6, 'specialties': ['strength'], 'work_mode': 'in_person', 'city': 'Beograd',
        }, format='json')
        invite = self.client.post('/api/coach/invitations/', {'label': 'Ana iz teretane'}, format='json').data
        self.assertEqual(invite['label'], 'Ana iz teretane')
        # Older apps post without a body.
        self.assertEqual(self.client.post('/api/coach/invitations/').status_code, 201)
        self.as_user(self.athlete)
        preview = self.client.get('/api/coach/invitations/preview/', {'code': invite['code'].lower()})
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['coach']['name'], 'Coach M')
        self.assertEqual(preview.data['coach']['city'], 'Beograd')
        self.assertNotIn('coach@example.test', str(preview.data))
        self.assertNotIn('Ana iz teretane', str(preview.data))  # the label is the coach's own note
        self.assertEqual(self.client.get('/api/coach/invitations/preview/', {'code': '0' * 16}).status_code, 400)
        self.assertEqual(self.client.get('/api/coach/invitations/preview/', {'code': 'x'}).status_code, 400)
        self.client.post('/api/coach/connect/', {'code': invite['code']}, format='json')
        dashboard = self.client.get('/api/coach/dashboard/').data
        self.assertEqual(dashboard['coach']['years_experience'], 6)
        # A redeemed code no longer reveals anything.
        self.as_user(self.stranger)
        self.assertEqual(self.client.get('/api/coach/invitations/preview/', {'code': invite['code']}).status_code, 400)


class TaskTests(WorkspaceTestCase):
    def test_finished_workout_raises_one_task_that_stays_closed(self):
        self.connect(days_ago=1)
        session = self.workout()
        first = self.tasks()
        self.assertEqual([(t['kind'], t['state']) for t in first], [('workout_review', 'open')])
        self.assertEqual(first[0]['data']['workout_id'], str(session.pk))
        self.assertEqual(len(self.tasks()), 1)  # a second look raises nothing new
        task_id = first[0]['id']
        self.assertEqual(self.client.patch(f'/api/coach/tasks/{task_id}/', {'action': 'done'}, format='json').data['state'], 'done')
        # Closed stays closed: the same workout is never raised again, even after the look-back.
        CoachConnection.objects.update(tasks_checked_at=None)
        self.assertEqual([t['state'] for t in self.tasks()], ['done'])
        self.assertEqual(self.client.patch(f'/api/coach/tasks/{task_id}/', {'action': 'reopen'}, format='json').data['state'], 'open')
        snoozed = self.client.patch(f'/api/coach/tasks/{task_id}/', {'action': 'snooze', 'days': 3}, format='json')
        self.assertEqual(snoozed.data['state'], 'snoozed')
        self.assertEqual(self.client.patch(f'/api/coach/tasks/{task_id}/', {'action': 'snooze'}, format='json').status_code, 400)
        self.assertEqual(self.client.get('/api/coach/dashboard/').data['clients'][0]['open_tasks'], 0)
        self.assertEqual(CoachTask.objects.count(), 1)

    def test_workouts_from_before_the_collaboration_are_not_tasks_but_late_offline_ones_are(self):
        self.workout(hours_ago=30)
        connection = self.connect()
        self.assertEqual(self.tasks(), [])
        # Logged offline after connecting, reaches the server later than the last check.
        CoachConnection.objects.filter(pk=connection.pk).update(tasks_checked_at=timezone.now())
        late = self.workout(hours_ago=0)
        WorkoutSession.objects.filter(pk=late.pk).update(created_at=timezone.now() + timedelta(seconds=5))
        self.assertEqual([t['data']['workout_id'] for t in self.tasks()], [str(late.pk)])

    def test_low_readiness_lists_the_answers_and_good_readiness_does_not(self):
        self.connect(days_ago=1)
        self.workout(hours_ago=3, sleep_hours=8, motivation=5, stress=1)
        low = self.workout(hours_ago=1, sleep_hours=4, stress=5, soreness_lower=5, motivation=2)
        tasks = [t for t in self.tasks() if t['kind'] == 'low_readiness']
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]['data']['workout_id'], str(low.pk))
        self.assertEqual(tasks[0]['data']['answers'], {'sleep_hours': 4, 'stress': 5, 'soreness_lower': 5, 'motivation': 2})
        self.assertLess(tasks[0]['data']['score'], 50)

    def test_personal_record_only_when_an_earlier_best_is_beaten(self):
        self.connect(days_ago=3)
        self.workout(hours_ago=48, weight='80', reps=5)  # the first time is no record
        self.workout(hours_ago=24, weight='75', reps=5)
        best = self.workout(hours_ago=1, weight='85', reps=5)
        records = [t for t in self.tasks() if t['kind'] == 'personal_record']
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['data']['workout_id'], str(best.pk))
        self.assertEqual(records[0]['data']['records'][0]['exercise_en'], 'Bench press')

    def test_inactivity_task_closes_when_the_client_trains_and_paused_clients_raise_none(self):
        connection = self.connect(days_ago=10)
        self.assertEqual([t['kind'] for t in self.tasks()], ['inactive'])
        self.workout()
        kinds = [t['kind'] for t in self.tasks()]
        self.assertNotIn('inactive', kinds)  # closed by itself, not shown as the coach's done work
        CoachTask.objects.all().delete()
        WorkoutSession.objects.all().delete()
        self.as_user(self.coach)
        self.assertEqual(self.client.patch(f'/api/coach/clients/{self.athlete.pk}/', {'status': 'paused'}, format='json').data['status'], 'paused')
        self.assertEqual(self.tasks(), [])
        # Resumed: inactivity counts from now, so nothing is raised right away.
        self.assertEqual(self.client.patch(f'/api/coach/clients/{self.athlete.pk}/', {'status': 'active'}, format='json').data['status'], 'active')
        self.assertEqual(self.tasks(), [])
        connection.refresh_from_db()
        self.assertGreater(connection.active_since, timezone.now() - timedelta(minutes=1))

    def test_tasks_are_the_coachs_own(self):
        self.connect(days_ago=1)
        self.workout()
        task_id = self.tasks()[0]['id']
        self.assertEqual(self.tasks(self.other_coach), [])
        self.assertEqual(self.client.patch(f'/api/coach/tasks/{task_id}/', {'action': 'done'}, format='json').status_code, 404)
        self.as_user(self.athlete)
        self.assertEqual(self.client.get('/api/coach/tasks/').status_code, 403)
        self.assertEqual(self.client.patch(f'/api/coach/clients/{self.athlete.pk}/', {'status': 'paused'}, format='json').status_code, 403)


class NotesAndArchiveTests(WorkspaceTestCase):
    def test_private_notes_never_reach_the_client(self):
        connection = self.connect()
        url = f'/api/coach/connections/{connection.pk}/notes/'
        self.as_user(self.coach)
        self.assertEqual(self.client.post(url, {'text': 'Watch the knees on squats'}, format='json').status_code, 201)
        shared = self.client.post(url, {'text': 'Two rest days this week', 'visible_to_client': True}, format='json').data
        self.assertEqual(len(self.client.get(url).data), 2)
        self.as_user(self.athlete)
        self.assertEqual([n['text'] for n in self.client.get(url).data], ['Two rest days this week'])
        self.assertEqual([n['text'] for n in self.client.get('/api/coach/dashboard/').data['shared_notes']], ['Two rest days this week'])
        self.assertEqual(self.client.post(url, {'text': 'Hi'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'/api/coach/notes/{shared["id"]}/', {'text': 'x'}, format='json').status_code, 403)
        for outsider in (self.stranger, self.other_coach):
            self.as_user(outsider)
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(f'/api/coach/notes/{shared["id"]}/', {'text': 'x'}, format='json').status_code, 404)
        # Making a private note shared is the coach's explicit choice.
        self.as_user(self.coach)
        self.assertTrue(self.client.patch(f'/api/coach/notes/{shared["id"]}/', {'visible_to_client': False}, format='json').status_code == 200)
        self.as_user(self.athlete)
        self.assertEqual(self.client.get(url).data, [])

    def test_ended_collaboration_is_a_read_only_archive_and_a_new_one_can_start(self):
        connection = self.connect()
        url = f'/api/coach/connections/{connection.pk}/notes/'
        self.as_user(self.coach)
        note = self.client.post(url, {'text': 'Own note'}, format='json').data
        self.client.post('/api/coach/messages/', {'text': 'Welcome', 'client_id': str(self.athlete.pk)}, format='json')
        self.assertEqual(self.client.delete(f'/api/coach/clients/{self.athlete.pk}/').status_code, 204)
        self.assertEqual([n['text'] for n in self.client.get(url).data], ['Own note'])
        self.assertEqual(self.client.post(url, {'text': 'More'}, format='json').status_code, 409)
        self.assertEqual(self.client.patch(f'/api/coach/notes/{note["id"]}/', {'text': 'x'}, format='json').status_code, 409)
        dashboard = self.client.get('/api/coach/dashboard/').data
        self.assertEqual(dashboard['clients'], [])
        self.assertEqual([c['status'] for c in dashboard['archived_clients']], ['ended'])
        conversations = self.client.get('/api/coach/conversations/').data
        self.assertEqual(conversations[0]['last_message']['text'], 'Welcome')
        # The athlete may start again with the same coach; the archive stays separate.
        self.as_user(self.coach)
        code = self.client.post('/api/coach/invitations/', {}, format='json').data['code']
        self.as_user(self.athlete)
        self.assertEqual(self.client.post('/api/coach/connect/', {'code': code}, format='json').status_code, 201)
        conversations = self.client.get('/api/coach/conversations/').data
        self.assertEqual([c['status'] for c in conversations], ['active', 'ended'])
        self.assertEqual(len(self.client.get('/api/coach/dashboard/').data['archived']), 1)

    def test_database_allows_one_active_coach_per_client(self):
        self.connect()
        with self.assertRaises(IntegrityError), transaction.atomic():
            CoachConnection.objects.create(coach=self.other_coach, client=self.athlete)
        CoachConnection.objects.update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.other_coach, client=self.athlete)
        self.assertEqual(CoachNote.objects.count(), 0)
