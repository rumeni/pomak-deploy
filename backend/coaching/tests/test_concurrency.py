"""Regression tests for PostgreSQL parent-row locking during connection teardown."""

import threading
import time

from django.db import close_old_connections, connections, transaction
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from coaching.models import CoachAssignment, CoachConnection, CoachMessage, CoachNote
from training.models import Routine


class ConnectionTeardownConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.coach = User.objects.create_user('coach-race@example.test', 'a-strong-password')
        self.coach.profile.is_coach = True
        self.coach.profile.save()
        self.trainee = User.objects.create_user('trainee-race@example.test', 'a-strong-password')
        self.connection = CoachConnection.objects.create(coach=self.coach, client=self.trainee)

    def _check_concurrent_disconnect(self, *, client_deletes: bool, write_message: bool):
        acquired = threading.Event()
        release = threading.Event()
        outcomes = []
        problems = []

        def writer():
            close_old_connections()
            try:
                with transaction.atomic():
                    row = CoachConnection.objects.select_for_update().get(pk=self.connection.pk)
                    acquired.set()
                    if not release.wait(timeout=8):
                        raise AssertionError('Wait timed out while holding connection lock')
                    if write_message:
                        CoachMessage.objects.create(connection=row, sender=self.coach, text='A queued message')
                    else:
                        copied = Routine.objects.create(owner=self.trainee, name='Workout from coach')
                        CoachAssignment.objects.create(connection=row, routine=copied)
            except Exception as error:
                problems.append(error)
            finally:
                connections.close_all()

        def disconnect():
            close_old_connections()
            try:
                api = APIClient()
                api.force_authenticate(user=self.trainee if client_deletes else self.coach)
                endpoint = '/api/coach/connection/' if client_deletes else f'/api/coach/clients/{self.trainee.pk}/'
                outcomes.append(api.delete(endpoint).status_code)
            except Exception as error:
                problems.append(error)
            finally:
                connections.close_all()

        write_thread = threading.Thread(target=writer)
        delete_thread = threading.Thread(target=disconnect)
        write_thread.start()
        try:
            self.assertTrue(acquired.wait(timeout=8), 'Writer never obtained row lock')
            delete_thread.start()
            time.sleep(0.15)  # Let the competing request reach the locked connection.
        finally:
            release.set()
            write_thread.join(timeout=12)
            if delete_thread.ident is not None:
                delete_thread.join(timeout=12)
        self.assertFalse(write_thread.is_alive())
        self.assertFalse(delete_thread.is_alive())
        self.assertFalse(problems, problems)
        self.assertEqual(outcomes, [204])
        # Ending archives the collaboration after the in-flight write: that write is kept, readable.
        self.assertIsNotNone(CoachConnection.objects.get(pk=self.connection.pk).ended_at)
        self.assertEqual(CoachMessage.objects.count(), 1 if write_message else 0)
        self.assertEqual(CoachAssignment.objects.count(), 0 if write_message else 1)
        if not write_message:
            self.assertEqual(Routine.objects.filter(owner=self.trainee).count(), 1)

    def test_client_disconnect_waits_for_inflight_message(self):
        self._check_concurrent_disconnect(client_deletes=True, write_message=True)

    def test_coach_disconnect_waits_for_inflight_assignment(self):
        self._check_concurrent_disconnect(client_deletes=False, write_message=False)


class NoteEndRaceTests(TransactionTestCase):
    """A note can never change after the collaboration ended, even if the end commits mid-request."""

    def setUp(self):
        self.coach = User.objects.create_user('coach-note-race@example.test', 'a-strong-password')
        self.coach.profile.is_coach = True
        self.coach.profile.save()
        self.trainee = User.objects.create_user('trainee-note-race@example.test', 'a-strong-password')
        self.connection = CoachConnection.objects.create(coach=self.coach, client=self.trainee)
        self.note = CoachNote.objects.create(connection=self.connection, text='Private', visible_to_client=False)

    def _race(self, method, body=None):
        acquired, release, outcomes, problems = threading.Event(), threading.Event(), [], []

        def ender():
            close_old_connections()
            try:
                with transaction.atomic():
                    row = CoachConnection.objects.select_for_update().get(pk=self.connection.pk)
                    acquired.set()
                    release.wait(timeout=8)
                    row.ended_at = timezone.now()
                    row.save(update_fields=['ended_at'])
            except Exception as error:
                problems.append(error)
            finally:
                connections.close_all()

        def editor():
            close_old_connections()
            try:
                api = APIClient()
                api.force_authenticate(user=self.coach)
                url = f'/api/coach/notes/{self.note.pk}/'
                response = api.patch(url, body, format='json') if method == 'patch' else api.delete(url)
                outcomes.append(response.status_code)
            except Exception as error:
                problems.append(error)
            finally:
                connections.close_all()

        end_thread, edit_thread = threading.Thread(target=ender), threading.Thread(target=editor)
        end_thread.start()
        self.assertTrue(acquired.wait(timeout=8))
        edit_thread.start()
        time.sleep(0.15)  # the edit reaches the locked collaboration
        release.set()
        end_thread.join(timeout=12)
        edit_thread.join(timeout=12)
        self.assertFalse(problems, problems)
        self.assertEqual(outcomes, [409])

    def test_making_a_private_note_shared_as_the_collaboration_ends_is_refused(self):
        self._race('patch', {'visible_to_client': True, 'text': 'Changed'})
        note = CoachNote.objects.get(pk=self.note.pk)
        self.assertEqual((note.text, note.visible_to_client), ('Private', False))

    def test_deleting_a_note_as_the_collaboration_ends_is_refused(self):
        self._race('delete')
        self.assertTrue(CoachNote.objects.filter(pk=self.note.pk).exists())
