from django.db.models import Case, IntegerField, QuerySet, Value, When
from django.db.models.functions import Coalesce, Lower, NullIf
from django.utils.translation import get_language

from core.text import normalize_search


def search_and_order(qs: QuerySet, query: str) -> QuerySet:
    """Pretraga i redosled za liste sa zajedničkim i ličnim zapisima (vežbe, namirnice).

    - svaka reč upita mora da se nađe u `search_name` (bez kvačica, oba jezika, drugi nazivi)
    - lični zapisi (owner != None) prvi
    - zatim po nazivu na jeziku korisnika; na srpskom po `search_name`, pa "Č" stoji uz "C"
    """
    for token in normalize_search(query).split():
        qs = qs.filter(search_name__contains=token)
    own_first = Case(When(owner__isnull=False, then=Value(0)), default=Value(1), output_field=IntegerField())
    if get_language() == 'en':
        return qs.order_by(own_first, Lower(Coalesce(NullIf('name_en', Value('')), 'name')))
    return qs.order_by(own_first, 'search_name')
