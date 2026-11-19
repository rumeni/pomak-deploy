from django.apps import AppConfig


class SchedulingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'scheduling'

    def ready(self):
        # A queued session reminder is re-checked right before it is sent.
        from notifications.push import GUARDS

        from .services import reminder_guard

        GUARDS['booking_reminder'] = reminder_guard
