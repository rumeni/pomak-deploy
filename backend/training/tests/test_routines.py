import uuid

from rest_framework.test import APITestCase

from accounts.models import User
from training.models import Exercise, Routine, RoutineSet


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

    def test_update_replaces_exercises(self):
        rid = self.create().data['id']
        body = self.payload(name='Trening A2')
        body['exercises'] = body['exercises'][1:]
        res = self.client.put(f'/api/training/routines/{rid}/', body, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['name'], 'Trening A2')
        self.assertEqual(len(res.data['exercises']), 1)
        self.assertEqual(RoutineSet.objects.count(), 1)

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
