from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response


class IdempotentCreateMixin:
    """POST sa ID-jem koji je klijent napravio.

    Ako zapis sa tim ID-jem već postoji kod istog korisnika, vraća se on (200) umesto
    duplikata; tako ponovljeno slanje posle prekida veze ne pravi dve kopije. ID koji
    pripada tuđem zapisu se odbija bez otkrivanja čiji je.
    """

    owner_field = 'user'

    def create(self, request, *args, **kwargs):
        record_id = request.data.get('id')
        if record_id:
            model = self.get_serializer_class().Meta.model
            try:
                existing = model.objects.filter(pk=record_id).first()
            except (ValueError, TypeError, DjangoValidationError):
                raise ValidationError({'id': _('Invalid ID.')})
            if existing is not None:
                if getattr(existing, f'{self.owner_field}_id') != request.user.pk:
                    raise ValidationError({'id': _('This ID is already taken.')})
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
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
