"""Workout tasks follow their workout: corrected -> current facts, deleted -> gone."""

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from training.models import WorkoutSession

from .tasks import reconcile_workout, workout_deleted


@receiver(post_save, sender=WorkoutSession, dispatch_uid='coaching_reconcile_corrected_workout')
def reconcile_corrected_workout(sender, instance, created, **kwargs):
    if created:
        return  # new workouts are picked up by the task sync
    # After commit: a correction replaces the sets after saving the workout itself.
    session_id = instance.pk
    transaction.on_commit(lambda: reconcile_workout(session_id))


@receiver(post_delete, sender=WorkoutSession, dispatch_uid='coaching_remove_deleted_workout_tasks')
def remove_deleted_workout_tasks(sender, instance, **kwargs):
    workout_deleted(instance.pk, instance.owner_id, instance.started_at)
