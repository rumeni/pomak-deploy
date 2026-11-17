import datetime

from django.db.models import Prefetch
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.search import search_and_order
from core.views import require_object_body
from core.views import IdempotentCreateMixin, SharedLibraryMixin

from . import open_food_facts
from .models import Food, FoodReport, MealEntry, NutritionDay, NutritionTarget, RecipeIngredient, SavedMeal, SavedMealItem
from .serializers import (
    BARCODE_RE,
    can_edit_food,
    FoodSerializer,
    MealEntrySerializer,
    MealEntryWriteSerializer,
    EstimateSerializer,
    NutritionDaySerializer,
    NutritionTargetSerializer,
    TargetWriteSerializer,
    RecipeSerializer,
    SavedMealSerializer,
)

SEARCH_LIMIT = 50


class FoodViewSet(
    IdempotentCreateMixin, SharedLibraryMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    """Zajedničke namirnice (USDA) + lične. Pretraga bez kvačica i na oba jezika (?q=piletina)."""

    serializer_class = FoodSerializer
    owner_field = 'owner'
    retry_action = 'update'
    shared_readonly_message = _('Foods from the shared database cannot be changed.')
    http_method_names = ['get', 'post', 'patch', 'delete']

    def get_queryset(self):
        qs = Food.visible_to(self.request.user).filter(archived_at__isnull=True).prefetch_related('portions')
        query = self.request.query_params.get('q', '').strip()
        if BARCODE_RE.fullmatch(query):
            # Typed or scanned barcode: the product itself.
            return qs.filter(barcode=query)
        return search_and_order(qs, query)

    def list(self, request, *args, **kwargs):
        return Response(self.get_serializer(self.get_queryset()[:SEARCH_LIMIT], many=True).data)

    def created_by_user(self, record, user) -> bool:
        # A shared community food has no owner; its author may still retry its creation.
        return record.owner_id == user.pk or (record.owner_id is None and record.created_by_id == user.pk)

    def _require_own(self, item):
        # A community food can be corrected by its author until an admin verified it.
        if not can_edit_food(item, self.request):
            raise PermissionDenied(self.shared_readonly_message)

    @action(detail=False, methods=['get'], url_path='barcode/(?P<code>[0-9]{8,14})')
    def barcode(self, request, code):
        """A scanned product: ours if we have it, else a suggestion from Open Food Facts to confirm."""
        food = Food.visible_to(request.user).filter(archived_at__isnull=True, barcode=code).order_by('owner').first()
        if food is not None:
            return Response({'food': self.get_serializer(food).data, 'suggestion': None})
        return Response({'food': None, 'suggestion': open_food_facts.lookup(code)})

    @action(detail=True, methods=['post'])
    def report(self, request, pk=None):
        """Report wrong values on a shared food; an admin reviews it."""
        food = self.get_object()
        if food.owner_id is not None:
            raise ValidationError(_('Only shared foods can be reported.'))
        reason = str(require_object_body(request).get('reason', '')).strip()[:300]
        if not reason:
            raise ValidationError({'reason': _('Say what is wrong.')})
        FoodReport.objects.update_or_create(
            food=food, reporter=request.user, resolved_at=None, defaults={'reason': reason},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class MealEntryView(APIView):
    """PUT /entries/<id>/ upisuje ili menja stavku (isti zahtev dvaput = isti rezultat); DELETE je briše."""

    def put(self, request, entry_id):
        existing = MealEntry.objects.filter(pk=entry_id).first()
        if existing is not None and existing.owner_id != request.user.pk:
            raise NotFound()
        serializer = MealEntryWriteSerializer(data=request.data, context={'request': request, 'existing': existing})
        serializer.is_valid(raise_exception=True)
        entry = serializer.save_entry(entry_id, request.user)
        return Response(MealEntrySerializer(entry).data, status=status.HTTP_200_OK if existing else status.HTTP_201_CREATED)

    def delete(self, request, entry_id):
        # Brisanje nepostojeće stavke je uspeh: ponovljeno slanje posle prekida veze ne sme da pukne.
        MealEntry.objects.filter(pk=entry_id, owner=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def parse_day(value: str) -> datetime.date:
    if not isinstance(value, str):
        raise ValidationError({'date': _('Invalid date.')})
    try:
        return datetime.date.fromisoformat(value)
    except (ValueError, TypeError):
        raise ValidationError({'date': _('Invalid date.')}) from None


class NutritionDayView(APIView):
    """GET: stavke i status dana. PUT: korisnik menja status (npr. potvrđuje da je dan kompletan)."""

    def get(self, request, day):
        day = parse_day(day)
        entries = MealEntry.objects.filter(owner=request.user, date=day)
        record = NutritionDay.objects.filter(owner=request.user, date=day).first()
        target = NutritionTarget.for_date(request.user, day)
        return Response({
            'date': day,
            'status': record.status if record else None,
            'entries': MealEntrySerializer(entries, many=True).data,
            'target': NutritionTargetSerializer(target).data if target else None,
        })

    def put(self, request, day):
        day = parse_day(day)
        serializer = NutritionDaySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        NutritionDay.objects.update_or_create(owner=request.user, date=day, defaults={'status': serializer.validated_data['status']})
        return Response({'date': day, 'status': serializer.validated_data['status']})


class RecentFoodsView(APIView):
    """Namirnice koje je korisnik nedavno upisivao, najnovije prve (za brzo ponavljanje)."""

    LIMIT = 20

    def get(self, request):
        seen, ids = set(), []
        recent = MealEntry.objects.filter(owner=request.user, food__isnull=False, food__archived_at__isnull=True)
        for food_id in recent.order_by('-created_at').values_list('food_id', flat=True)[:200]:
            if food_id not in seen:
                seen.add(food_id)
                ids.append(food_id)
            if len(ids) == self.LIMIT:
                break
        foods = {f.id: f for f in Food.objects.filter(pk__in=ids).prefetch_related('portions')}
        return Response(FoodSerializer([foods[i] for i in ids if i in foods], many=True).data)


class SavedMealViewSet(
    IdempotentCreateMixin, mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    """Sačuvani obroci korisnika (pravljenje, lista, brisanje)."""

    serializer_class = SavedMealSerializer
    owner_field = 'owner'
    retry_action = 'compare'

    def get_queryset(self):
        items = SavedMealItem.objects.select_related('food').prefetch_related('food__portions')
        return SavedMeal.objects.filter(owner=self.request.user).prefetch_related(Prefetch('items', queryset=items))

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class RecipeViewSet(
    IdempotentCreateMixin, SharedLibraryMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.CreateModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    """Recepti korisnika. Brisanje je arhiviranje (ranije upisani obroci ostaju)."""

    serializer_class = RecipeSerializer
    owner_field = 'owner'
    retry_action = 'update'
    http_method_names = ['get', 'post', 'put', 'patch', 'delete']

    def get_queryset(self):
        ingredients = RecipeIngredient.objects.select_related('food').prefetch_related('food__portions')
        return (
            Food.objects.filter(owner=self.request.user, source=Food.Source.RECIPE, archived_at__isnull=True)
            .prefetch_related('portions', Prefetch('ingredients', queryset=ingredients))
            .order_by('search_name')
        )


def parse_target_day(value: str) -> datetime.date:
    """Cilj važi od danas ili kasnije: raniji dani zadržavaju tadašnji cilj (AC-07).
    Dan ranije je dozvoljen zbog razlike u vremenskoj zoni telefona i servera."""
    day = parse_day(value)
    if day < timezone.localdate() - datetime.timedelta(days=1):
        raise ValidationError({'valid_from': _('A new target can start today or later.')})
    return day


class TargetEstimateView(APIView):
    """POST: pregled predloga aplikacije pre prihvatanja (ništa se ne čuva)."""

    def post(self, request):
        require_object_body(request)
        serializer = EstimateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        valid_from = parse_target_day(request.data.get('valid_from') or timezone.localdate().isoformat())
        return Response(serializer.estimate(request.user, valid_from))


class TargetListView(APIView):
    """GET: istorija ciljeva, najnoviji prvi."""

    def get(self, request):
        return Response(NutritionTargetSerializer(NutritionTarget.objects.filter(owner=request.user), many=True).data)


class TargetView(APIView):
    """PUT /targets/<datum>/: cilj koji važi od tog datuma (isti zahtev dvaput = isti rezultat)."""

    def put(self, request, day):
        valid_from = parse_target_day(day)
        serializer = TargetWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.save_target(request.user, valid_from)
        return Response(NutritionTargetSerializer(target).data)
