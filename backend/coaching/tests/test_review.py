"""Workout review, comments on workouts, client statistics and a coach-set nutrition target (T2b)."""

from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import CoachConnection, CoachMessage, CoachTask
from nutrition.models import NutritionTarget
from training.models import Exercise, RoutineSet, SessionExercise, SetLog, WorkoutSession


class ReviewTestCase(APITestCase):
    def setUp(self):
        self.coach = self.user('review-coach@example.test', coach=True)
        self.other_coach = self.user('review-other@example.test', coach=True)
        self.ana = self.user('review-ana@example.test')
        self.other = self.user('review-other-client@example.test')
        self.connection = CoachConnection.objects.create(coach=self.coach, client=self.ana)
        CoachConnection.objects.create(coach=self.other_coach, client=self.other)
        self.bench = Exercise.objects.create(
            owner=None, slug='review-bench', name='Bench', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST,
        )
        self.workout = self.session(self.ana)

    def user(self, email, *, coach=False):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.save()
        return user

    def session(self, owner, **extra):
        now = timezone.now()
        session = WorkoutSession.objects.create(
            owner=owner, name='Upper A', started_at=now - timedelta(hours=1), finished_at=now,
            plan_snapshot={'name': 'Upper A', 'exercises': [{'exercise': {'id': str(self.bench.pk), 'name': 'Bench'},
                                                             'sets': [{'set_type': 'working', 'reps_min': 8, 'reps_max': 10, 'weight_kg': '60.00'}]}]},
            sleep_hours=4, stress=5, **extra,
        )
        item = SessionExercise.objects.create(session=session, exercise=self.bench, position=0)
        SetLog.objects.create(session_exercise=item, position=0, set_type=RoutineSet.SetType.WORKING, reps=9, weight_kg='60')
        return session

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def bound(self, **body):
        return {'connection_id': str(self.connection.pk), **body}

    def url(self, suffix=''):
        return f'/api/coach/clients/{self.ana.pk}/workouts/{self.workout.pk}/{suffix}'


class WorkoutReviewTests(ReviewTestCase):
    def test_planned_and_done_side_by_side_readiness_only_with_consent(self):
        self.as_user(self.coach)
        data = self.client.get(self.url()).data
        self.assertEqual(data['plan']['exercises'][0]['sets'][0]['reps_min'], 8)
        self.assertEqual(data['exercises'][0]['sets'][0]['reps'], 9)
        self.assertIsNone(data['readiness'])
        CoachConnection.objects.filter(pk=self.connection.pk).update(share_readiness=True)
        self.assertEqual(self.client.get(self.url()).data['readiness']['answers']['sleep_hours'], 4)

    def test_only_the_coach_of_an_active_collaboration_and_only_the_clients_workouts(self):
        foreign = self.session(self.other)
        self.as_user(self.coach)
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/workouts/{foreign.pk}/').status_code, 404)
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        self.as_user(self.ana)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_marking_reviewed_closes_the_review_task(self):
        self.as_user(self.coach)
        self.assertIsNone(self.client.get(self.url()).data['reviewed_at'])
        self.assertEqual(self.client.post(self.url('reviewed/'), self.bound(), format='json').status_code, 200)
        task = CoachTask.objects.get(kind='workout_review', key=str(self.workout.pk))
        self.assertEqual(task.status, 'done')
        self.assertIsNotNone(self.client.get(self.url()).data['reviewed_at'])
        self.client.post(self.url('reviewed/'), self.bound(), format='json')  # again: still one task
        self.assertEqual(CoachTask.objects.filter(kind='workout_review').count(), 1)


class WorkoutCommentTests(ReviewTestCase):
    def test_a_comment_is_one_message_seen_in_the_chat_and_with_the_workout(self):
        self.as_user(self.coach)
        sent = self.client.post('/api/coach/messages/', {
            'text': 'Odlično, sledeći put 62,5', 'client_id': str(self.ana.pk), 'workout_id': str(self.workout.pk),
        }, format='json')
        self.assertEqual(sent.status_code, 201, sent.data)
        self.assertEqual(sent.data['workout']['name'], 'Upper A')
        self.client.post('/api/coach/messages/', {'text': 'Plain message', 'client_id': str(self.ana.pk)}, format='json')
        self.assertEqual([c['text'] for c in self.client.get(self.url()).data['comments']], ['Odlično, sledeći put 62,5'])
        self.as_user(self.ana)
        chat = self.client.get('/api/coach/messages/').data
        self.assertEqual(len(chat), 2)
        on_workout = self.client.get('/api/coach/messages/', {'workout_id': str(self.workout.pk)}).data
        self.assertEqual([m['text'] for m in on_workout], ['Odlično, sledeći put 62,5'])
        reply = self.client.post('/api/coach/messages/', {'text': 'Važi!', 'workout_id': str(self.workout.pk)}, format='json')
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(CoachMessage.objects.filter(workout=self.workout).count(), 2)

    def test_only_the_clients_own_workouts_and_a_deleted_workout_leaves_the_message(self):
        foreign = self.session(self.other)
        self.as_user(self.coach)
        self.assertEqual(self.client.post('/api/coach/messages/', {
            'text': 'x', 'client_id': str(self.ana.pk), 'workout_id': str(foreign.pk),
        }, format='json').status_code, 400)
        self.client.post('/api/coach/messages/', {
            'text': 'About this one', 'client_id': str(self.ana.pk), 'workout_id': str(self.workout.pk),
        }, format='json')
        self.workout.delete()
        message = self.client.get('/api/coach/messages/', {'client_id': str(self.ana.pk)}).data[-1]
        self.assertEqual((message['text'], message['workout']), ('About this one', None))


class ClientStatsTests(ReviewTestCase):
    def test_statistics_without_readiness_unless_shared(self):
        self.as_user(self.coach)
        stats = self.client.get(f'/api/coach/clients/{self.ana.pk}/stats/', {'period': '30'}).data
        self.assertEqual(stats['totals']['sessions'], 1)
        self.assertEqual(stats['readiness'], [])
        CoachConnection.objects.filter(pk=self.connection.pk).update(share_readiness=True)
        self.assertEqual(len(self.client.get(f'/api/coach/clients/{self.ana.pk}/stats/').data['readiness']), 1)
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/stats/', {'period': 'x'}).status_code, 400)
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/stats/').status_code, 404)


class CoachNutritionTargetTests(ReviewTestCase):
    def target_url(self):
        return f'/api/coach/clients/{self.ana.pk}/nutrition-target/'

    def test_setting_the_target_needs_its_own_consent(self):
        self.as_user(self.coach)
        self.assertEqual(self.client.get(self.target_url()).data['allowed'], False)
        body = {'valid_from': timezone.localdate().isoformat(), 'kcal': 2200}
        self.assertEqual(self.client.post(self.target_url(), self.bound(**body), format='json').status_code, 400)
        self.as_user(self.ana)
        changed = self.client.patch('/api/coach/connection/', {'coach_sets_nutrition': True}, format='json').data
        self.assertTrue(changed['coach_sets_nutrition'])
        self.assertEqual(changed['access_version'], 2)
        self.as_user(self.coach)
        response = self.client.post(self.target_url(), self.bound(**{**body, 'protein_g': 150, 'note': 'Više proteina'}), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['current']['kcal'], 2200)
        target = NutritionTarget.objects.get(owner=self.ana)
        self.assertEqual((target.mode, target.set_by), ('coach', self.coach))
        # The client sees it as his target, marked as set by the coach.
        self.as_user(self.ana)
        listed = self.client.get('/api/nutrition/targets/').data
        mine = (listed['results'] if isinstance(listed, dict) and 'results' in listed else listed)[0]
        self.assertEqual((mine['kcal'], mine['mode']), (2200, 'coach'))

    def test_rules_for_dates_and_macros_and_one_target_per_date(self):
        CoachConnection.objects.filter(pk=self.connection.pk).update(coach_sets_nutrition=True)
        self.as_user(self.coach)
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        self.assertEqual(self.client.post(self.target_url(), self.bound(**{'valid_from': yesterday, 'kcal': 2000}), format='json').status_code, 400)
        today = timezone.localdate().isoformat()
        self.assertEqual(self.client.post(self.target_url(), self.bound(**{'valid_from': today, 'kcal': 1500, 'fat_g': 200}), format='json').status_code, 400)
        self.client.post(self.target_url(), self.bound(**{'valid_from': today, 'kcal': 2000}), format='json')
        self.client.post(self.target_url(), self.bound(**{'valid_from': today, 'kcal': 2100}), format='json')
        self.assertEqual(list(NutritionTarget.objects.filter(owner=self.ana).values_list('kcal', flat=True)), [2100])


class ReviewAccessTests(ReviewTestCase):
    def test_every_coach_view_carries_its_access_facts(self):
        self.as_user(self.coach)
        for url in (self.url(), f'/api/coach/clients/{self.ana.pk}/stats/', f'/api/coach/clients/{self.ana.pk}/nutrition-target/',
                    f'/api/coach/clients/{self.ana.pk}/weeks/{timezone.localdate().isoformat()}/'):
            access = self.client.get(url).data['access']
            self.assertEqual((access['connection_id'], access['access_version']), (str(self.connection.pk), 1), url)
            self.assertIn('coach_sets_nutrition', access)

    def test_only_workouts_of_this_collaboration_can_be_marked_reviewed(self):
        old = self.session(self.ana)
        WorkoutSession.objects.filter(pk=old.pk).update(finished_at=self.connection.created_at - timedelta(days=1))
        self.as_user(self.coach)
        url = f'/api/coach/clients/{self.ana.pk}/workouts/{old.pk}/'
        self.assertFalse(self.client.get(url).data['reviewable'])
        self.assertEqual(self.client.post(url + 'reviewed/', self.bound(), format='json').status_code, 400)
        self.assertTrue(self.client.get(self.url()).data['reviewable'])


class ReviewIntegrityTests(ReviewTestCase):
    def test_a_deleted_workout_is_missing_not_a_lost_collaboration(self):
        self.as_user(self.coach)
        url = self.url()
        self.assertEqual(self.client.get(url).status_code, 200)
        self.workout.delete()
        gone = self.client.get(url)
        self.assertEqual((gone.status_code, gone.data['code']), (404, 'workout_not_found'))
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/plan/').status_code, 200)
        self.as_user(self.other_coach)
        lost = self.client.get(f'/api/coach/clients/{self.ana.pk}/stats/')
        self.assertEqual((lost.status_code, lost.data['code']), (404, 'collaboration_not_found'))

    def test_malformed_plan_snapshots_never_break_the_review(self):
        self.as_user(self.coach)
        for snapshot in ({'exercises': {}}, {'exercises': [None, 3]}, {'exercises': [{'exercise': {'name': {'x': 1}}, 'sets': {}}]},
                         {'exercises': [{'exercise': 'x', 'sets': [None, {'reps_min': 'eight', 'weight_kg': 'heavy', 'set_type': 7}]}]},
                         ['not', 'a', 'dict'], None):
            WorkoutSession.objects.filter(pk=self.workout.pk).update(plan_snapshot=snapshot)
            response = self.client.get(self.url())
            self.assertEqual(response.status_code, 200, snapshot)
            plan = response.data['plan']
            if plan is not None:
                for exercise in plan['exercises']:
                    self.assertTrue(exercise['exercise']['name'] is None or isinstance(exercise['exercise']['name'], str))
                    for s in exercise['sets']:
                        self.assertIn(s['set_type'], ('warmup', 'working'))
                        self.assertIsNone(s['reps_min']) if s['reps_min'] is None else self.assertIsInstance(s['reps_min'], int)
            self.assertEqual(response.data['exercises'][0]['sets'][0]['reps'], 9)

    def test_target_and_review_writes_are_bound_to_their_collaboration(self):
        CoachConnection.objects.filter(pk=self.connection.pk).update(coach_sets_nutrition=True)
        stale = str(self.connection.pk)
        CoachConnection.objects.filter(pk=self.connection.pk).update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.coach, client=self.ana, coach_sets_nutrition=True)
        self.as_user(self.coach)
        target = self.client.post(f'/api/coach/clients/{self.ana.pk}/nutrition-target/',
                                  {'connection_id': stale, 'valid_from': timezone.localdate().isoformat(), 'kcal': 2000}, format='json')
        self.assertEqual(target.status_code, 409)
        self.assertFalse(NutritionTarget.objects.exists())
        self.assertEqual(self.client.post(self.url('reviewed/'), {'connection_id': stale}, format='json').status_code, 409)

