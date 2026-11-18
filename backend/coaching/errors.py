"""Errors the app tells apart by `code`: a missing workout is not a lost collaboration."""

from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound


def collaboration_not_found():
    """No active collaboration with this client for this coach: access is gone."""
    return NotFound({'detail': _('Not found.'), 'code': 'collaboration_not_found'})


def workout_not_found():
    """The collaboration is fine; only this workout does not exist (any more)."""
    return NotFound({'detail': _('That workout no longer exists.'), 'code': 'workout_not_found'})


class CollaborationChanged(APIException):
    """The write was meant for another collaboration than the one active now (ended, or a new one
    with the same person since): nothing is written; the app reloads and asks again."""

    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({'detail': _('The collaboration changed. Reload and try again.'), 'code': 'collaboration_changed'})
