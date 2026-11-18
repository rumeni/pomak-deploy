"""Program templates and client plans (T2a)."""

import uuid
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import ClientPlanVersion, CoachConnection
from training.models import Exercise, Routine, RoutineExercise, RoutineSet


class PlanTestCase(APITestCase):
    def setUp(self):
        self.coach = self.user('plan-coach@example.test', coach=True)
        self.other_coach = self.user('plan-other@example.test', coach=True)
        self.ana = self.user('ana@example.test', name='Ana')
        self.marko = self.user('marko@example.test', name='Marko')
        self.stranger = self.user('stranger@example.test')
        self.bench = Exercise.objects.create(
            owner=None, slug='plan-bench', name='Bench', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST,
        )
        self.secret = Exercise.objects.create(
            owner=self.coach, slug='plan-secret', name='Secret move', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST,
        )
        self.upper = self.routine('Upper A', weight='60')
        self.lower = self.routine('Lower A', weight='80')
        for client in (self.ana, self.marko):
            CoachConnection.objects.create(coach=self.coach, client=client)
        self.today = timezone.localdate()

    def user(self, email, *, coach=False, name=''):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.display_name = name
        user.profile.save()
        return user

    def routine(self, name, *, owner=None, weight='60', exercise=None):
        routine = Routine.objects.create(owner=owner or self.coach, name=name)
        item = RoutineExercise.objects.create(routine=routine, exercise=exercise or self.bench, position=0)
        RoutineSet.objects.create(routine_exercise=item, position=0, reps_min=8, reps_max=10, weight_kg=weight)
        return routine

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def template(self, **extra):
        self.as_user(self.coach)
        body = {'name': 'Upper/Lower', 'weeks': 4, 'days': [
            {'weekday': 0, 'routine_id': str(self.upper.pk)}, {'weekday': 3, 'routine_id': str(self.lower.pk)},
        ], **extra}
        response = self.client.post('/api/coach/templates/', body, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def assign(self, template_id, clients, start, request_id=None):
        self.as_user(self.coach)
        return self.client.post(f'/api/coach/templates/{template_id}/assign/', {
            'client_ids': [str(c.pk) for c in clients], 'start_date': start.isoformat(),
            'request_id': request_id,
        }, format='json')


class TemplateTests(PlanTestCase):
    def test_a_template_uses_the_coachs_own_shareable_routines(self):
        template = self.template()
        self.assertEqual([d['weekday'] for d in template['days']], [0, 3])
        bad = [
            [{'weekday': 0, 'routine_id': str(self.routine('Theirs', owner=self.other_coach).pk)}],
            [{'weekday': 0, 'routine_id': str(self.routine('Private', exercise=self.secret).pk)}],
            [{'weekday': 0, 'routine_id': str(self.upper.pk)}, {'weekday': 0, 'routine_id': str(self.lower.pk)}],
            [],
        ]
        for days in bad:
            self.assertEqual(self.client.post('/api/coach/templates/', {'name': 'X', 'days': days}, format='json').status_code, 400)
        self.as_user(self.ana)
        self.assertEqual(self.client.get('/api/coach/templates/').status_code, 403)
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(f"/api/coach/templates/{template['id']}/").status_code, 404)


class AssignTests(PlanTestCase):
    def test_each_client_gets_independent_copies_from_the_start_date(self):
        template = self.template()
        start = self.today + timedelta(days=3)
        response = self.assign(template['id'], [self.ana, self.marko, self.stranger], start)
        self.assertEqual([r['ok'] for r in response.data['results']], [True, True, False])
        self.assertEqual(Routine.objects.filter(owner=self.ana).count(), 2)
        self.assertEqual(Routine.objects.filter(owner=self.marko).count(), 2)
        # Changing the template (and its routine) later changes no client plan.
        RoutineSet.objects.filter(routine_exercise__routine=self.upper).update(weight_kg='100')
        self.client.put(f"/api/coach/templates/{template['id']}/", {'name': 'Changed', 'days': [
            {'weekday': 1, 'routine_id': str(self.upper.pk)}]}, format='json')
        plan = self.client.get(f'/api/coach/clients/{self.ana.pk}/plan/').data
        version = plan['versions'][0]
        self.assertEqual((version['name'], version['state'], version['valid_from']), ('Upper/Lower', 'upcoming', start))
        self.assertEqual([d['weekday'] for d in version['days']], [0, 3])
        copy = Routine.objects.get(owner=self.ana, name='Upper A')
        self.assertEqual(str(RoutineSet.objects.get(routine_exercise__routine=copy).weight_kg), '60.00')
        self.assertEqual(version['valid_until'], start + timedelta(weeks=4) - timedelta(days=1))

    def test_a_retried_assignment_creates_nothing_twice(self):
        template = self.template()
        request_id = str(uuid.uuid4())
        self.assign(template['id'], [self.ana], self.today, request_id)
        self.assign(template['id'], [self.ana], self.today, request_id)
        self.assertEqual(ClientPlanVersion.objects.count(), 1)
        self.assertEqual(Routine.objects.filter(owner=self.ana).count(), 2)

    def test_no_start_in_the_past(self):
        template = self.template()
        self.assertEqual(self.assign(template['id'], [self.ana], self.today - timedelta(days=1)).status_code, 400)


class PlanChangeTests(PlanTestCase):
    def setUp(self):
        super().setUp()
        template = self.template(weeks=None)
        self.assign(template['id'], [self.ana], self.today)
        self.url = f'/api/coach/clients/{self.ana.pk}/plan/versions/'
        self.plan = self.client.get(f'/api/coach/clients/{self.ana.pk}/plan/').data
        self.monday_routine = self.plan['versions'][0]['days'][0]['routine']['id']

    def test_a_change_from_a_later_date_keeps_today_and_can_tailor_a_routine(self):
        tailored = {'name': 'Upper A (Ana)', 'notes': '', 'exercises': [{
            'exercise_id': str(self.bench.pk), 'rest_seconds': 90, 'notes': '',
            'sets': [{'set_type': 'working', 'reps_min': 5, 'reps_max': 5, 'weight_kg': '55', 'duration_seconds': None,
                      'distance_m': None, 'rpe': None}],
        }]}
        later = self.today + timedelta(days=7)
        response = self.client.post(self.url, {'valid_from': later.isoformat(), 'reason': 'Lakše zbog kolena', 'days': [
            {'weekday': 0, 'keep_routine_id': self.monday_routine},
            {'weekday': 2, 'routine': tailored},
        ]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        states = [(v['state'], v['reason']) for v in response.data['versions']]
        self.assertEqual(states, [('current', ''), ('upcoming', 'Lakše zbog kolena')])
        made = Routine.objects.get(owner=self.ana, name='Upper A (Ana)')
        self.assertEqual(str(RoutineSet.objects.get(routine_exercise__routine=made).weight_kg), '55.00')
        # Private exercises of the coach never reach the client, not even in a tailored routine.
        tailored['exercises'][0]['exercise_id'] = str(self.secret.pk)
        self.assertEqual(self.client.post(self.url, {'valid_from': later.isoformat(), 'days': [
            {'weekday': 2, 'routine': tailored}]}, format='json').status_code, 400)

    def test_replacing_a_version_archives_only_copies_no_longer_used(self):
        thursday_routine = self.plan['versions'][0]['days'][1]['routine']['id']
        response = self.client.post(self.url, {'valid_from': self.today.isoformat(), 'days': [
            {'weekday': 0, 'keep_routine_id': self.monday_routine},
        ]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data['versions']), 1)
        self.assertIsNone(Routine.objects.get(pk=self.monday_routine).archived_at)
        self.assertIsNotNone(Routine.objects.get(pk=thursday_routine).archived_at)

    def test_a_pause_and_rules_for_dates_and_routines(self):
        pause = self.client.post(self.url, {'valid_from': (self.today + timedelta(days=1)).isoformat(), 'days': []}, format='json')
        self.assertEqual(pause.data['versions'][-1]['days'], [])
        self.assertEqual(self.client.post(self.url, {'valid_from': (self.today - timedelta(days=1)).isoformat(), 'days': []}, format='json').status_code, 400)
        foreign = self.routine('Not in plan', owner=self.ana)
        self.assertEqual(self.client.post(self.url, {'valid_from': self.today.isoformat(), 'days': [
            {'weekday': 0, 'keep_routine_id': str(foreign.pk)}]}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url, {'valid_from': self.today.isoformat(), 'days': [
            {'weekday': 0, 'keep_routine_id': self.monday_routine, 'routine_id': str(self.upper.pk)}]}, format='json').status_code, 400)

    def test_only_the_coach_of_an_active_collaboration_sees_or_changes_the_plan(self):
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/plan/').status_code, 404)
        self.assertEqual(self.client.post(self.url, {'valid_from': self.today.isoformat(), 'days': []}, format='json').status_code, 404)
        self.as_user(self.ana)
        mine = self.client.get('/api/coach/plan/').data
        self.assertEqual(mine['current_version_id'], self.plan['current_version_id'])
        self.as_user(self.marko)
        self.assertIsNone(self.client.get('/api/coach/plan/').data)
        CoachConnection.objects.filter(client=self.ana).update(ended_at=timezone.now())
        self.as_user(self.ana)
        self.assertIsNone(self.client.get('/api/coach/plan/').data)
        self.as_user(self.coach)
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/plan/').status_code, 404)

    def test_today_shows_the_routine_planned_for_this_weekday(self):
        days = [{'weekday': self.today.weekday(), 'keep_routine_id': self.monday_routine}]
        self.client.post(self.url, {'valid_from': self.today.isoformat(), 'days': days}, format='json')
        self.as_user(self.ana)
        today = self.client.get('/api/coach/plan/').data['today']
        self.assertEqual(today['routine']['id'], self.monday_routine)
