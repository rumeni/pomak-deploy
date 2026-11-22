"""Program templates and client plans (T2a)."""

import uuid
from unittest import mock
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import ClientPlanVersion, CoachConnection, PlanRequest
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
            'connection_ids': [self.connection_id(c) for c in clients], 'start_date': start.isoformat(),
            'request_id': request_id or str(uuid.uuid4()),
        }, format='json')

    def connection_id(self, client):
        """The collaboration the wizard shows for this client (any, or a made-up one for a stranger)."""
        connection = CoachConnection.objects.filter(client=client, ended_at__isnull=True).first()
        return str(connection.pk) if connection else str(uuid.uuid4())

    def plan_of(self, client):
        self.as_user(self.coach)
        response = self.client.get(f'/api/coach/clients/{client.pk}/plan/')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['plan']


class TemplateTests(PlanTestCase):
    def test_a_template_uses_the_coachs_own_shareable_routines(self):
        template = self.template()
        self.assertEqual([d['weekday'] for d in template['days']], [0, 3])
        bad = [
            [{'weekday': 0, 'routine_id': str(self.routine('Theirs', owner=self.other_coach).pk)}],
            [{'weekday': 0, 'routine_id': str(self.upper.pk)}, {'weekday': 0, 'routine_id': str(self.lower.pk)}],
            [],
        ]
        for days in bad:
            self.assertEqual(self.client.post('/api/coach/templates/', {'name': 'X', 'days': days}, format='json').status_code, 400)
        # A routine with the coach's private exercises is fine: assigning copies them to each client.
        private = [{'weekday': 0, 'routine_id': str(self.routine('Private', exercise=self.secret).pk)}]
        self.assertEqual(self.client.post('/api/coach/templates/', {'name': 'X', 'days': private}, format='json').status_code, 201)
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
        version = self.plan_of(self.ana)['versions'][0]
        self.assertEqual((version['name'], version['state'], version['valid_from']), ('Upper/Lower', 'upcoming', start))
        self.assertEqual([d['weekday'] for d in version['days']], [0, 3])
        self.assertEqual(version['days'][0]['routine']['exercises'][0]['sets'][0]['weight_kg'], '60.00')
        copy = Routine.objects.get(owner=self.ana, name='Upper A')
        self.assertEqual(str(RoutineSet.objects.get(routine_exercise__routine=copy).weight_kg), '60.00')
        self.assertEqual(version['valid_until'], start + timedelta(weeks=4) - timedelta(days=1))

    def test_a_retried_assignment_creates_nothing_twice_also_partially_and_after_the_day(self):
        template = self.template()
        request_id = str(uuid.uuid4())
        first = self.assign(template['id'], [self.ana], self.today, request_id)
        self.assertEqual([r['ok'] for r in first.data['results']], [True])
        # Retry of the whole request, with one more client that the first attempt never reached.
        self.as_user(self.coach)
        body = {'connection_ids': [self.connection_id(self.ana)], 'start_date': self.today.isoformat(), 'request_id': request_id}
        self.assertEqual(self.client.post(f"/api/coach/templates/{template['id']}/assign/", body, format='json').status_code, 200)
        self.assertEqual(ClientPlanVersion.objects.count(), 1)
        self.assertEqual(Routine.objects.filter(owner=self.ana).count(), 2)
        # The same ID with other content is refused, not silently applied.
        other = {**body, 'reason': 'Different'}
        result = self.client.post(f"/api/coach/templates/{template['id']}/assign/", other, format='json')
        self.assertEqual(result.status_code, 409)
        self.assertEqual(ClientPlanVersion.objects.count(), 1)

    def test_no_start_in_the_past(self):
        template = self.template()
        self.assertEqual(self.assign(template['id'], [self.ana], self.today - timedelta(days=1)).status_code, 400)


class PrivateExerciseTests(PlanTestCase):
    """A coach's private exercise reaches each client as the client's own labelled copy."""

    def setUp(self):
        super().setUp()
        self.coach.profile.display_name = 'Coach Nina'
        self.coach.profile.save()
        self.private = self.routine('Private A', exercise=self.secret)
        self.as_user(self.coach)
        response = self.client.post('/api/coach/templates/', {'name': 'Private', 'days': [
            {'weekday': 0, 'routine_id': str(self.private.pk)}]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.template_id = response.data['id']

    def test_each_client_gets_his_own_copy_and_the_plan_points_at_it(self):
        result = self.assign(self.template_id, [self.ana, self.marko], self.today)
        self.assertEqual([r['ok'] for r in result.data['results']], [True, True], result.data)
        copies = {c: Exercise.objects.get(owner=c, source_exercise=self.secret) for c in (self.ana, self.marko)}
        self.assertNotEqual(copies[self.ana].pk, copies[self.marko].pk)
        self.assertEqual({c.coach_name for c in copies.values()}, {'Coach Nina'})
        for client, copy in copies.items():
            day = self.plan_of(client)['versions'][0]['days'][0]
            self.assertEqual(day['routine']['exercises'][0]['exercise_id'], str(copy.pk))
            self.assertEqual(Routine.objects.get(pk=day['routine']['id']).exercises.get().exercise_id, copy.pk)
        # The coach's own exercise is untouched and nothing entered the shared library.
        self.secret.refresh_from_db()
        self.assertEqual(self.secret.owner, self.coach)
        self.assertFalse(Exercise.objects.filter(owner__isnull=True, name='Secret move').exists())

    def test_measurement_mismatch_in_batch_skips_only_that_client_and_retry_recovers(self):
        # Pre-existing client copy is mutable, while the coach's prescription is still weight/reps.
        third = self.user('luka@example.test', name='Luka')
        CoachConnection.objects.create(coach=self.coach, client=third)
        first = self.assign(self.template_id, [self.marko], self.today)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual([r['ok'] for r in first.data['results']], [True])
        client_copy = Exercise.objects.get(owner=self.marko, source_exercise=self.secret)
        self.as_user(self.marko)
        edited = self.client.patch(f'/api/training/exercises/{client_copy.pk}/', {
            'measurement': Exercise.Measurement.DURATION,
        }, format='json')
        self.assertEqual(edited.status_code, 200, edited.data)

        marko_routines = Routine.objects.filter(owner=self.marko).count()
        marko_versions = ClientPlanVersion.objects.filter(plan__connection__client=self.marko).count()
        original_marko_version = ClientPlanVersion.objects.get(plan__connection__client=self.marko).pk
        marko_receipts = PlanRequest.objects.filter(connection__client=self.marko).count()
        request_id = str(uuid.uuid4())
        batch = self.assign(self.template_id, [self.ana, self.marko, third], self.today, request_id)
        self.assertEqual(batch.status_code, 200, batch.data)
        self.assertEqual([r['ok'] for r in batch.data['results']], [True, False, True])
        self.assertEqual(batch.data['results'][1]['error'], 'exercise_configuration_changed')
        self.assertEqual(batch.data['results'][1]['name'], 'Marko')
        self.assertEqual(Routine.objects.filter(owner=self.marko).count(), marko_routines)
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=self.marko).count(), marko_versions)
        self.assertEqual(ClientPlanVersion.objects.get(plan__connection__client=self.marko).pk, original_marko_version)
        self.assertEqual(PlanRequest.objects.filter(connection__client=self.marko).count(), marko_receipts)
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=self.ana).count(), 1)
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=third).count(), 1)
        client_copy.refresh_from_db()
        self.assertEqual(client_copy.measurement, Exercise.Measurement.DURATION)

        # Retry with the same ID: successful clients are not assigned twice; repaired client now succeeds.
        self.as_user(self.marko)
        restored = self.client.patch(f'/api/training/exercises/{client_copy.pk}/', {
            'measurement': Exercise.Measurement.WEIGHT_REPS,
        }, format='json')
        self.assertEqual(restored.status_code, 200, restored.data)
        retry = self.assign(self.template_id, [self.ana, self.marko, third], self.today, request_id)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual([r['ok'] for r in retry.data['results']], [True, True, True])
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=self.ana).count(), 1)
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=third).count(), 1)
        # Assigning on the same start date replaces Marko's old version, not adds a second one.
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=self.marko).count(), marko_versions)
        self.assertNotEqual(ClientPlanVersion.objects.get(plan__connection__client=self.marko).pk, original_marko_version)
        self.assertEqual(PlanRequest.objects.filter(connection__client=self.marko).count(), marko_receipts + 1)

    def test_changed_load_mode_in_batch_skips_one_client_and_preserves_other_plans(self):
        third = self.user('load-luka@example.test', name='Luka')
        CoachConnection.objects.create(coach=self.coach, client=third)
        self.assertEqual(self.assign(self.template_id, [self.marko], self.today).status_code, 200)
        copy = Exercise.objects.get(owner=self.marko, source_exercise=self.secret)
        self.as_user(self.marko)
        changed = self.client.patch(f'/api/training/exercises/{copy.pk}/', {
            'load_mode': Exercise.LoadMode.PER_SIDE,
        }, format='json')
        self.assertEqual(changed.status_code, 200, changed.data)
        before_routines = Routine.objects.filter(owner=self.marko).count()
        before_versions = list(ClientPlanVersion.objects.filter(plan__connection__client=self.marko).values_list('pk', flat=True))
        before_receipts = PlanRequest.objects.filter(connection__client=self.marko).count()
        response = self.assign(self.template_id, [self.ana, self.marko, third], self.today)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([r['ok'] for r in response.data['results']], [True, False, True])
        self.assertEqual(response.data['results'][1]['error'], 'exercise_configuration_changed')
        self.assertEqual(Routine.objects.filter(owner=self.marko).count(), before_routines)
        self.assertEqual(list(ClientPlanVersion.objects.filter(plan__connection__client=self.marko).values_list('pk', flat=True)), before_versions)
        self.assertEqual(PlanRequest.objects.filter(connection__client=self.marko).count(), before_receipts)
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=self.ana).count(), 1)
        self.assertEqual(ClientPlanVersion.objects.filter(plan__connection__client=third).count(), 1)
        copy.refresh_from_db()
        self.assertEqual(copy.load_mode, Exercise.LoadMode.PER_SIDE)

    def test_tailoring_a_kept_day_accepts_the_clients_copy(self):
        self.assign(self.template_id, [self.ana], self.today)
        copy = Exercise.objects.get(owner=self.ana, source_exercise=self.secret)
        self.as_user(self.coach)
        response = self.client.post(f'/api/coach/clients/{self.ana.pk}/plan/versions/', {
            'valid_from': (self.today + timedelta(days=7)).isoformat(), 'request_id': str(uuid.uuid4()),
            'connection_id': self.connection_id(self.ana),
            'days': [{'weekday': 0, 'routine': {'name': 'Private A (Ana)', 'notes': '', 'exercises': [{
                'exercise_id': str(copy.pk), 'rest_seconds': 60, 'notes': '',
                'sets': [{'set_type': 'working', 'reps_min': 6, 'reps_max': 6, 'weight_kg': '40',
                          'duration_seconds': None, 'distance_m': None, 'rpe': None}],
            }]}}],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        made = Routine.objects.get(owner=self.ana, name='Private A (Ana)')
        self.assertEqual(made.exercises.get().exercise_id, copy.pk)
        self.assertEqual(Exercise.objects.filter(owner=self.ana).count(), 1)


class PlanChangeTests(PlanTestCase):
    def setUp(self):
        super().setUp()
        template = self.template(weeks=None)
        self.assign(template['id'], [self.ana], self.today)
        self.url = f'/api/coach/clients/{self.ana.pk}/plan/versions/'
        self.plan = self.plan_of(self.ana)
        self.monday_routine = self.plan['versions'][0]['days'][0]['routine']['id']

    def change(self, valid_from, days, request_id=None, connection_id=None, **extra):
        self.as_user(self.coach)
        return self.client.post(self.url, {
            'valid_from': valid_from.isoformat(), 'days': days, 'request_id': request_id or str(uuid.uuid4()),
            'connection_id': connection_id or self.connection_id(self.ana), **extra,
        }, format='json')

    def tailored(self, weight='55', exercise=None):
        return {'name': 'Upper A (Ana)', 'notes': '', 'exercises': [{
            'exercise_id': str((exercise or self.bench).pk), 'rest_seconds': 90, 'notes': '',
            'sets': [{'set_type': 'working', 'reps_min': 5, 'reps_max': 5, 'weight_kg': weight, 'duration_seconds': None,
                      'distance_m': None, 'rpe': None}],
        }]}

    def test_a_change_from_a_later_date_keeps_today_and_can_tailor_a_routine(self):
        later = self.today + timedelta(days=7)
        response = self.change(later, [
            {'weekday': 0, 'keep_routine_id': self.monday_routine}, {'weekday': 2, 'routine': self.tailored()},
        ], reason='Lakše zbog kolena')
        self.assertEqual(response.status_code, 201, response.data)
        versions = response.data['plan']['versions']
        self.assertEqual([(v['state'], v['reason']) for v in versions], [('current', ''), ('upcoming', 'Lakše zbog kolena')])
        # The current version now ends the day before the next one starts: no overlapping history.
        self.assertEqual(versions[0]['valid_until'], later - timedelta(days=1))
        made = Routine.objects.get(owner=self.ana, name='Upper A (Ana)')
        self.assertEqual(str(RoutineSet.objects.get(routine_exercise__routine=made).weight_kg), '55.00')
        # Someone else's private exercise is never accepted.
        theirs = Exercise.objects.create(
            owner=self.other_coach, name='Not yours', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST,
        )
        self.assertEqual(self.change(later, [{'weekday': 2, 'routine': self.tailored(exercise=theirs)}]).status_code, 400)

    def test_editing_his_copy_never_rewrites_what_was_prescribed(self):
        copy = Routine.objects.get(pk=self.monday_routine)
        RoutineSet.objects.filter(routine_exercise__routine=copy).update(weight_kg='5')
        copy.name = 'Mine now'
        copy.save()
        day = self.plan_of(self.ana)['versions'][0]['days'][0]['routine']
        self.assertEqual((day['name'], day['exercises'][0]['sets'][0]['weight_kg']), ('Upper A', '60.00'))
        self.assertEqual(day['id'], self.monday_routine)  # still the routine he trains with
        # Keeping it in a new version keeps the prescription, not his edits.
        response = self.change(self.today + timedelta(days=1), [{'weekday': 0, 'keep_routine_id': self.monday_routine}])
        kept = response.data['plan']['versions'][-1]['days'][0]['routine']
        self.assertEqual(kept['exercises'][0]['sets'][0]['weight_kg'], '60.00')

    def test_a_delayed_retry_never_brings_back_a_replaced_version(self):
        day = self.today + timedelta(days=2)
        request_a = str(uuid.uuid4())
        a = [{'weekday': 0, 'keep_routine_id': self.monday_routine}]
        self.assertEqual(self.change(day, a, request_a, name='A').status_code, 201)
        self.assertEqual(self.change(day, [], name='B').status_code, 201)  # replaced by B on the same date
        retry = self.change(day, a, request_a, name='A')
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.data['plan']['versions'][-1]['name'], 'B')
        self.assertEqual(self.change(day, [], request_a, name='Other').status_code, 409)

    def test_an_exact_retry_succeeds_even_after_its_day(self):
        request_id = str(uuid.uuid4())
        self.assertEqual(self.change(self.today, [], request_id).status_code, 201)
        PlanRequest.objects.filter(request_id=request_id)  # receipt exists
        with mock.patch('coaching.plans.timezone.localdate', return_value=self.today + timedelta(days=3)):
            self.assertEqual(self.change(self.today, [], request_id).status_code, 200)

    def test_replacing_a_version_archives_only_copies_no_longer_used(self):
        thursday_routine = self.plan['versions'][0]['days'][1]['routine']['id']
        response = self.change(self.today, [{'weekday': 0, 'keep_routine_id': self.monday_routine}])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data['plan']['versions']), 1)
        self.assertIsNone(Routine.objects.get(pk=self.monday_routine).archived_at)
        self.assertIsNotNone(Routine.objects.get(pk=thursday_routine).archived_at)

    def test_a_pause_and_rules_for_dates_and_routines(self):
        pause = self.change(self.today + timedelta(days=1), [])
        self.assertEqual(pause.data['plan']['versions'][-1]['days'], [])
        self.assertEqual(self.change(self.today - timedelta(days=1), []).status_code, 400)
        foreign = self.routine('Not in plan', owner=self.ana)
        self.assertEqual(self.change(self.today, [{'weekday': 0, 'keep_routine_id': str(foreign.pk)}]).status_code, 400)
        self.assertEqual(self.change(self.today, [
            {'weekday': 0, 'keep_routine_id': self.monday_routine, 'routine_id': str(self.upper.pk)}]).status_code, 400)
        self.as_user(self.coach)
        self.assertEqual(self.client.post(self.url, {'valid_from': self.today.isoformat(), 'days': []}, format='json').status_code, 400)

    def test_only_the_coach_of_an_active_collaboration_sees_or_changes_the_plan(self):
        access = self.client.get(f'/api/coach/clients/{self.ana.pk}/plan/').data['access']
        self.assertEqual(access['access_version'], 1)
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(f'/api/coach/clients/{self.ana.pk}/plan/').status_code, 404)
        self.assertEqual(self.client.post(self.url, {'valid_from': self.today.isoformat(), 'days': [],
                                                     'request_id': str(uuid.uuid4()), 'connection_id': self.connection_id(self.ana)},
                                          format='json').status_code, 409)
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
        self.change(self.today, [{'weekday': self.today.weekday(), 'keep_routine_id': self.monday_routine}])
        self.as_user(self.ana)
        today = self.client.get('/api/coach/plan/').data['today']
        self.assertEqual(today['routine']['id'], self.monday_routine)


class CollaborationBindingTests(PlanTestCase):
    def test_a_delayed_assignment_never_lands_in_a_newer_collaboration(self):
        template = self.template()
        old_connection = self.connection_id(self.ana)
        request_id = str(uuid.uuid4())
        body = {'connection_ids': [old_connection], 'start_date': (self.today + timedelta(days=2)).isoformat(), 'request_id': request_id}
        # Ended and connected again before the delayed request arrives.
        CoachConnection.objects.filter(pk=old_connection).update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.as_user(self.coach)
        result = self.client.post(f"/api/coach/templates/{template['id']}/assign/", body, format='json')
        self.assertEqual(result.data['results'], [{'connection_id': old_connection, 'ok': False, 'error': 'collaboration_changed'}])
        self.assertIsNone(self.plan_of(self.ana))

    def test_a_stale_editor_cannot_change_the_plan_of_a_newer_collaboration(self):
        old_connection = self.connection_id(self.ana)
        CoachConnection.objects.filter(pk=old_connection).update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.coach, client=self.ana)
        self.as_user(self.coach)
        response = self.client.post(f'/api/coach/clients/{self.ana.pk}/plan/versions/', {
            'valid_from': self.today.isoformat(), 'days': [], 'request_id': str(uuid.uuid4()), 'connection_id': old_connection,
        }, format='json')
        self.assertEqual((response.status_code, response.data['code']), (409, 'collaboration_changed'))
        self.assertIsNone(self.plan_of(self.ana))

