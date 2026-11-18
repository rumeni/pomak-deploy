"""Unread messages: one forward read cursor per side of a collaboration."""

from django.db import transaction
from django.db.models import Count, F, Q

from .models import CoachConnection, CoachMessage


def _after(side):
    """Messages after this side's read cursor (or all of them when it has read nothing)."""
    at, ident = f'connection__{side}_read_at', f'connection__{side}_read_id'
    return (
        Q(**{f'{at}__isnull': True})
        | Q(created_at__gt=F(at))
        | Q(created_at=F(at), id__gt=F(ident))
    )


def unread_counts(user, connections=None) -> dict:
    """Unread messages per collaboration of this user (only the other side's messages count)."""
    rows = CoachMessage.objects.exclude(sender=user).filter(
        (Q(connection__coach=user) & _after('coach')) | (Q(connection__client=user) & _after('client')),
    )
    if connections is not None:
        rows = rows.filter(connection__in=connections)
    return dict(rows.values('connection_id').annotate(n=Count('id')).values_list('connection_id', 'n'))


def mark_read(user, message) -> int:
    """Everything up to this message is read for the user's side; returns what is still unread.

    The cursor only moves forward, so an older view (another tab, a delayed request) never makes
    messages unread again. The collaboration row is locked, as in every other write to it.
    """
    with transaction.atomic():
        connection = CoachConnection.objects.select_for_update().get(pk=message.connection_id)
        side = 'coach' if connection.coach_id == user.pk else 'client'
        at, ident = getattr(connection, f'{side}_read_at'), getattr(connection, f'{side}_read_id')
        if at is None or (message.created_at, str(message.pk)) > (at, str(ident)):
            setattr(connection, f'{side}_read_at', message.created_at)
            setattr(connection, f'{side}_read_id', message.pk)
            connection.save(update_fields=[f'{side}_read_at', f'{side}_read_id', 'updated_at'])
    return unread_counts(user, [connection]).get(connection.pk, 0)
