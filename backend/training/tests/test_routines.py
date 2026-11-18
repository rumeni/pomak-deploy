import uuid
from unittest import mock

from rest_framework.test import APITestCase

from accounts.models import User
from training.models import Exercise, Routine, RoutineSet
from training.views import RoutineViewSet


class RoutineTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('a@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.bench = Exercise.objects.get(slug='bench-press')
        self.row = Exercise.objects.get(slug='barbell-row')

    def payload(self, **extra):
        return {
            'name': 'Trening A',
            'notes': '',
            'exercises': [
                {'exercise_id': str(self.bench.id), 'rest_seconds': 120, 'notes': '', 'sets': [
                    {'set_type': 'warmup', 'reps_min': 10, 'reps_max': 10, 'weight_kg': '40'},
                    {'set_type': 'working', 'reps_min': 8, 'reps_max': 10, 'weight_kg': '60'},
                    {'set_type': 'working', 'reps_min': 8, 'reps_max': 10, 'weight_kg': '60'},
                ]},
                {'exercise_id': str(self.row.id), 'rest_seconds': 90, 'notes': '', 'sets': [
                    {'set_type': 'working', 'reps_min': 10, 'reps_max': 12, 'weight_kg': None},
                ]},
            ],
            **extra,
        }

    def create(self, body=None):
        return self.client.post('/api/training/routines/', body or self.payload(), format='json')

    def test_create_and_read_back_in_order(self):
        res = self.create()
        self.assertEqual(res.status_code, 201, res.data)
        detail = self.client.get(f"/api/training/routines/{res.data['id']}/").data
        self.assertEqual([e['exercise']['name'] for e in detail['exercises']], [self.bench.name, self.row.name])
        self.assertEqual([s['set_type'] for s in detail['exercises'][0]['sets']], ['warmup', 'working', 'working'])
        self.assertEqual(detail['exercises'][0]['sets'][1]['weight_kg'], '60.00')

    def test_resending_same_id_does_not_duplicate(self):
        body = self.payload(id=str(uuid.uuid4()))
        self.assertEqual(self.create(body).status_code, 201)
        self.assertEqual(self.create(body).status_code, 200)
        self.assertEqual(Routine.objects.count(), 1)

    def test_concurrent_create_collision_retries_instead_of_server_error(self):
        body = self.payload(id=str(uuid.uuid4()))
        self.assertEqual(self.create(body).status_code, 201)
        stored = Routine.objects.get(pk=body['id'])
        # A second request saw no row before the first insert committed.
        with mock.patch.object(RoutineViewSet, 'find_existing', side_effect=[None, stored]):
            retry = self.create(body)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(Routine.objects.count(), 1)

    def test_program_key_is_stable_after_editing_the_routine(self):
        res = self.create(self.payload(program_key='full-body-beginner'))
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['program_key'], 'full-body-beginner')
        updated = self.client.put(
            f"/api/training/routines/{res.data['id']}/",
            self.payload(name='My custom routine', program_key='other-key'), format='json',
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['program_key'], 'full-body-beginner')

    def test_retry_changed_post_updates_owned_routine_instead_of_silently_dropping_changes(self):
        body = self.payload(id=str(uuid.uuid4()), name='Prva')
        first = self.create(body)
        self.assertEqual(first.status_code, 201, first.data)
        initial_set_ids = set(RoutineSet.objects.values_list('pk', flat=True))
        repeated = self.create(body)
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(set(RoutineSet.objects.values_list('pk', flat=True)), initial_set_ids)

        changed = self.payload(id=body['id'], name='Izmenjena')
        changed['exercises'][0]['sets'][0]['reps_min'] = 6
        changed['exercises'][0]['sets'][0]['reps_max'] = 8
        updated = self.create(changed)
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['name'], 'Izmenjena')
        self.assertEqual(updated.data['exercises'][0]['sets'][0]['reps_min'], 6)
        self.assertEqual(Routine.objects.count(), 1)

        invalid = self.payload(id=body['id'], name='Never saved')
        invalid['exercises'][0]['sets'][0]['reps_min'] = 1000
        self.assertEqual(self.create(invalid).status_code, 400)
        self.assertEqual(Routine.objects.get(pk=body['id']).name, 'Izmenjena')

    def test_retry_post_cannot_reactivate_archived_routine(self):
        body = self.payload(id=str(uuid.uuid4()))
        self.assertEqual(self.create(body).status_code, 201)
        self.assertEqual(self.client.delete(f"/api/training/routines/{body['id']}/").status_code, 204)
        retry = self.create(self.payload(id=body['id'], name='Back from archive'))
        self.assertEqual(retry.status_code, 409)
        self.assertIsNotNone(Routine.objects.get(pk=body['id']).archived_at)

    def test_update_replaces_exercises(self):
        rid = self.create().data['id']
        body = self.payload(name='Trening A2')
        body['exercises'] = body['exercises'][1:]
        res = self.client.put(f'/api/training/routines/{rid}/', body, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['name'], 'Trening A2')
        self.assertEqual(len(res.data['exercises']), 1)
        self.assertEqual(RoutineSet.objects.count(), 1)

    def test_invalid_client_uuid_is_bad_request_not_server_error(self):
        res = self.create(self.payload(id="not-a-uuid"))
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("id", res.data)

    def test_validation(self):
        body = self.payload()
        body['exercises'][0]['sets'][1]['reps_min'] = 12
        self.assertEqual(self.create(body).status_code, 400)

        body = self.payload()
        body['exercises'][0]['sets'] = []
        self.assertEqual(self.create(body).status_code, 400)

        self.assertEqual(self.create(self.payload(name='  ')).status_code, 400)

    def test_cannot_use_other_users_custom_exercise(self):
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        private = Exercise.objects.create(owner=other, name='Tajna', equipment='other', measurement='weight_reps', muscle='core')
        body = self.payload()
        body['exercises'][0]['exercise_id'] = str(private.id)
        self.assertEqual(self.create(body).status_code, 400)

    def test_routines_are_private(self):
        rid = self.create().data['id']
        other = User.objects.create_user('c@d.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(f'/api/training/routines/{rid}/').status_code, 404)
        self.assertEqual(self.client.get('/api/training/routines/').data, [])

    def test_delete_archives_and_duplicate_copies(self):
        rid = self.create().data['id']
        copy = self.client.post(f'/api/training/routines/{rid}/duplicate/')
        self.assertEqual(copy.status_code, 201, copy.data)
        self.assertEqual(copy.data['name'], 'Trening A (kopija)')
        self.assertEqual(len(copy.data['exercises'][0]['sets']), 3)

        self.assertEqual(self.client.delete(f'/api/training/routines/{rid}/').status_code, 204)
        self.assertTrue(Routine.objects.filter(pk=rid, archived_at__isnull=False).exists())
        self.assertEqual([r['name'] for r in self.client.get('/api/training/routines/').data], ['Trening A (kopija)'])


class CreateOnlyRoutineTests(APITestCase):
    """`?create_only=1` (program import): create the ID or leave the existing routine alone."""

    def setUp(self):
        self.user = User.objects.create_user('co@b.rs', 'jaka-lozinka-123')
        self.client.force_authenticate(self.user)
        self.bench = Exercise.objects.get(slug='bench-press')

    def body(self, routine_id, name='Celo telo A'):
        return {'id': routine_id, 'name': name, 'notes': '', 'exercises': [{
            'exercise_id': str(self.bench.id), 'rest_seconds': 120, 'notes': '',
            'sets': [{'set_type': 'working', 'reps_min': 8, 'reps_max': 10, 'weight_kg': None,
                      'duration_seconds': None, 'distance_m': None, 'rpe': '6.5'}],
        }]}

    def post(self, body, create_only=True):
        return self.client.post('/api/training/routines/' + ('?create_only=1' if create_only else ''), body, format='json')

    def test_an_existing_routine_is_never_overwritten(self):
        rid = str(uuid.uuid4())
        self.assertEqual(self.post(self.body(rid)).status_code, 201)
        # The user edits it; then the other tab's import sends the original payload.
        self.client.put(f'/api/training/routines/{rid}/', self.body(rid, name='Moj A'), format='json')
        res = self.post(self.body(rid))
        self.assertEqual(res.status_code, 412)
        self.assertEqual(Routine.objects.get(pk=rid).name, 'Moj A')
        # Ordinary (editor) retries keep updating as before.
        self.assertEqual(self.post(self.body(rid, name='Editor retry'), create_only=False).status_code, 200)
        self.assertEqual(Routine.objects.get(pk=rid).name, 'Editor retry')

    def test_two_creates_of_the_same_new_id_at_once_leave_one_untouched_routine(self):
        from training.views import RoutineViewSet
        rid = str(uuid.uuid4())
        # The other tab's create landed just after this request looked for the ID.
        Routine.objects.create(id=rid, owner=self.user, name='Iz drugog taba')
        with mock.patch.object(RoutineViewSet, 'find_existing', return_value=None):
            res = self.post(self.body(rid))
        self.assertEqual(res.status_code, 412)
        self.assertEqual(Routine.objects.filter(pk=rid).count(), 1)
        self.assertEqual(Routine.objects.get(pk=rid).name, 'Iz drugog taba')

    def test_another_users_id_is_still_refused(self):
        rid = str(uuid.uuid4())
        self.post(self.body(rid))
        self.client.force_authenticate(User.objects.create_user('drugi@b.rs', 'jaka-lozinka-123'))
        self.assertEqual(self.post(self.body(rid)).status_code, 400)
