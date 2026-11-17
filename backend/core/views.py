from collections.abc import Mapping
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response


def require_object_body(request):
    """Return 400 for non-object JSON before any .get() or other dict access."""
    if not isinstance(request.data, Mapping):
        raise ValidationError({'detail': _('Expected a JSON object.')})
    return request.data


class AlreadySavedConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = _('This item was already saved. Refresh to see the saved version.')
    default_code = 'already_saved'


_TRIMMED_WRITE_FIELDS = frozenset({'name', 'notes', 'note', 'portion_name'})
_NUMERIC_WRITE_FIELDS = frozenset({
    'value', 'target_value', 'start_value', 'grams', 'mass_g', 'weight_kg',
    'reps_min', 'reps_max', 'rest_seconds', 'duration_seconds', 'distance_m',
    'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'servings',
})


def _matches_saved_payload(incoming, saved, field=''):
    """Compare only client-supplied fields, including nested items and UUID links.

    Decimal API representation may differ from inputs (e.g. 60 vs "60.00").
    Exact retries must stay read-only, notably for routines/recipes whose
    serializer.update replaces nested rows or recalculates nutrition.
    """
    if isinstance(incoming, Mapping):
        if not isinstance(saved, Mapping):
            return False
        for name, value in incoming.items():
            if name.endswith('_id') and name not in saved:
                relation = saved.get(name[:-3])
                existing = relation.get('id') if isinstance(relation, Mapping) else None
            else:
                if name not in saved:
                    return False
                existing = saved[name]
            if not _matches_saved_payload(value, existing, name):
                return False
        return True
    if isinstance(incoming, list):
        return isinstance(saved, list) and len(incoming) == len(saved) and all(
            _matches_saved_payload(a, b, field) for a, b in zip(incoming, saved, strict=True)
        )
    if incoming is None or saved is None:
        return incoming is None and saved is None
    # DRF CharField trims whitespace before storing, including the nested
    # names/portion labels. An exact network retry must compare those
    # normalized values rather than treating the original whitespace as an edit.
    if field in _TRIMMED_WRITE_FIELDS and isinstance(incoming, str) and isinstance(saved, str):
        return incoming.strip() == saved.strip()
    if field in _NUMERIC_WRITE_FIELDS:
        try:
            return Decimal(str(incoming)) == Decimal(str(saved))
        except (InvalidOperation, ValueError, TypeError):
            return False
    return incoming == saved


class IdempotentCreateMixin:
    """A client-chosen UUID identifies a create attempt, not an unconditional success.

    retry_action:
      - return: identical or divergent repeats return the original (immutable workouts).
      - update: repeated changed POST validates and updates like PUT/PATCH.
      - compare: identical repeats return 200; changed contents raise 409.
        retry_compare_fields may restrict the comparison to user-chosen fields.
    """

    owner_field = 'user'
    retry_action = 'return'
    retry_compare_fields = None

    def _matches_retry(self, body, saved):
        if self.retry_compare_fields is not None:
            # Goals have server-managed start values/dates, so only compare
            # the user's original choices. Missing optional fields mean None.
            body = {key: body.get(key) for key in self.retry_compare_fields}
            saved = {key: saved.get(key) for key in self.retry_compare_fields}
        return _matches_saved_payload(body, saved)

    def create(self, request, *args, **kwargs):
        body = require_object_body(request)
        record_id = body.get('id')
        if record_id:
            model = self.get_serializer_class().Meta.model
            try:
                existing = model.objects.filter(pk=record_id).first()
            except (ValueError, TypeError, DjangoValidationError):
                raise ValidationError({'id': _('Invalid ID.')}) from None
            if existing is not None:
                if getattr(existing, f'{self.owner_field}_id') != request.user.pk:
                    raise ValidationError({'id': _('This ID is already taken.')})

                action = self.retry_action
                if action == 'return':
                    return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
                # Do not resurrect archived routines or change a custom Food into
                # a recipe just because its UUID collides with the submitted recipe.
                if not self.get_queryset().filter(pk=existing.pk).exists():
                    raise AlreadySavedConflict()

                old_data = self.get_serializer(existing).data
                if self._matches_retry(body, old_data):
                    return Response(old_data, status=status.HTTP_200_OK)
                if action == 'compare':
                    raise AlreadySavedConflict()

                if action == 'update':
                    serializer = self.get_serializer(existing, data=body)
                    serializer.is_valid(raise_exception=True)
                    self.perform_update(serializer)
                    return Response(serializer.data, status=status.HTTP_200_OK)
                raise RuntimeError('Unsupported retry_action')
        return super().create(request, *args, **kwargs)


class SharedLibraryMixin:
    """Za biblioteke sa zajedničkim (owner=None) i ličnim zapisima (vežbe, namirnice).

    Korisnik pravi samo lične zapise, menja samo svoje, a brisanje je arhiviranje: stari
    treninzi i dnevnici koji ga pominju ostaju čitljivi.
    """

    shared_readonly_message = _('Items from the shared library cannot be changed.')

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def _require_own(self, item):
        if item.owner_id != self.request.user.pk:
            raise PermissionDenied(self.shared_readonly_message)

    def perform_update(self, serializer):
        self._require_own(serializer.instance)
        serializer.save()

    def perform_destroy(self, item):
        self._require_own(item)
        item.archived_at = timezone.now()
        item.save(update_fields=['archived_at', 'updated_at'])
