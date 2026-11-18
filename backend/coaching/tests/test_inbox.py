"""Unread messages and exercise instructions (T3a)."""

from datetime import timedelta
from uuid import uuid4

from django.utils import timezone

from coaching.models import CoachConnection, CoachMessage, ExerciseInstruction
from training.models import Exercise

from .test_review import ReviewTestCase


class UnreadTests(ReviewTestCase):
    def message(self, sender, text='Hi', connection=None, at=None):
        message = CoachMessage.objects.create(connection=connection or self.connection, sender=sender, text=text)
        if at is not None:
            CoachMessage.objects.filter(pk=message.pk).update(created_at=at)
            message.refresh_from_db()
        return message

    def unread(self, user):
        self.as_user(user)
        return self.client.get('/api/coach/unread/').data['total']

    def read(self, user, message):
        self.as_user(user)
        return self.client.post('/api/coach/messages/read/', {'message_id': str(message.pk)}, format='json')

    def test_only_the_other_sides_messages_are_unread_until_read(self):
        now = timezone.now()
        first = self.message(self.ana, 'Pitanje', at=now - timedelta(minutes=3))
        self.message(self.coach, 'Odgovor', at=now - timedelta(minutes=2))
        last = self.message(self.ana, 'Hvala', at=now - timedelta(minutes=1))
        self.assertEqual((self.unread(self.coach), self.unread(self.ana)), (2, 1))
        self.as_user(self.coach)
        row = self.client.get('/api/coach/dashboard/').data['clients'][0]
        self.assertEqual(row['unread_messages'], 2)
        self.assertEqual(self.client.get('/api/coach/conversations/').data[0]['unread'], 2)
        self.assertEqual(self.read(self.coach, first).data['unread'], 1)
        self.assertEqual(self.read(self.coach, last).data['unread'], 0)
        # The cursor only moves forward: an older view never makes messages unread again.
        self.assertEqual(self.read(self.coach, first).data['unread'], 0)
        self.assertEqual(self.unread(self.ana), 1)
        self.as_user(self.ana)
        self.assertEqual(self.client.get('/api/coach/dashboard/').data['unread_messages'], 1)

    def test_messages_at_the_same_instant_are_ordered_by_id(self):
        at = timezone.now()
        a, b = sorted((self.message(self.ana, 'A', at=at), self.message(self.ana, 'B', at=at)), key=lambda m: str(m.pk))
        self.read(self.coach, a)
        self.assertEqual(self.unread(self.coach), 1)
        self.read(self.coach, b)
        self.assertEqual(self.unread(self.coach), 0)

    def test_archived_conversations_count_and_strangers_cannot_mark(self):
        message = self.message(self.ana)
        CoachConnection.objects.filter(pk=self.connection.pk).update(ended_at=timezone.now())
        self.assertEqual(self.unread(self.coach), 1)
        self.assertEqual(self.read(self.other_coach, message).status_code, 404)
        self.assertEqual(self.read(self.other, message).status_code, 404)
        self.assertEqual(self.read(self.coach, message).status_code, 200)
        self.assertEqual(self.unread(self.coach), 0)
        self.as_user(self.coach)
        self.assertEqual(self.client.post('/api/coach/messages/read/', {'message_id': str(uuid4())}, format='json').status_code, 404)


class InstructionTests(ReviewTestCase):
    def instructions_url(self):
        return f'/api/coach/clients/{self.ana.pk}/instructions/'

    def put(self, text, exercise=None, connection_id=None):
        self.as_user(self.coach)
        return self.client.put(self.instructions_url(), {
            'connection_id': connection_id or str(self.connection.pk), 'exercise_id': str((exercise or self.bench).pk), 'text': text,
        }, format='json')

    def test_the_client_sees_the_instruction_while_the_collaboration_lasts(self):
        response = self.put('  Lopatice skupljene, spusti polako.  ')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['text'], 'Lopatice skupljene, spusti polako.')
        self.put('Pauza na grudima.')  # one per exercise: replaced, not added
        self.assertEqual(ExerciseInstruction.objects.count(), 1)
        self.as_user(self.ana)
        mine = self.client.get('/api/coach/instructions/').data
        self.assertEqual([(x['exercise_id'], x['text']) for x in mine], [(str(self.bench.pk), 'Pauza na grudima.')])
        # Another client never sees it.
        self.as_user(self.other)
        self.assertEqual(self.client.get('/api/coach/instructions/').data, [])
        # After the end, nothing is shown to the client and the coach can no longer write.
        CoachConnection.objects.filter(pk=self.connection.pk).update(ended_at=timezone.now())
        self.as_user(self.ana)
        self.assertEqual(self.client.get('/api/coach/instructions/').data, [])
        self.assertEqual(self.put('Novo').status_code, 409)

    def test_empty_text_removes_it(self):
        self.put('Lakše')
        self.assertEqual(self.put('  ').data['results'], [])
        self.assertFalse(ExerciseInstruction.objects.exists())

    def test_only_exercises_the_client_can_have_and_only_his_coach(self):
        foreign = Exercise.objects.create(
            owner=self.other, slug='other-own', name='Tuđa', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST,
        )
        own = Exercise.objects.create(
            owner=self.ana, slug='ana-own', name='Moja', equipment=Exercise.Equipment.BARBELL,
            measurement=Exercise.Measurement.WEIGHT_REPS, muscle=Exercise.Muscle.CHEST,
        )
        self.assertEqual(self.put('x', exercise=foreign).status_code, 400)
        self.assertEqual(self.put('x', exercise=own).status_code, 200)
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(self.instructions_url()).status_code, 404)

    def test_a_stale_editor_cannot_write_into_a_newer_collaboration(self):
        stale = str(self.connection.pk)
        CoachConnection.objects.filter(pk=self.connection.pk).update(ended_at=timezone.now())
        CoachConnection.objects.create(coach=self.coach, client=self.ana)
        response = self.put('Stara poruka', connection_id=stale)
        self.assertEqual((response.status_code, response.data['code']), (409, 'collaboration_changed'))
        self.assertFalse(ExerciseInstruction.objects.exists())
