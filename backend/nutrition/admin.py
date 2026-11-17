from django.contrib import admin

from django.db import transaction
from django.utils import timezone

from .models import Food, FoodPortion, FoodReport


class FoodPortionInline(admin.TabularInline):
    model = FoodPortion
    extra = 0


@admin.register(Food)
class FoodAdmin(admin.ModelAdmin):
    list_display = ['name', 'state', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source', 'barcode', 'verified_at', 'owner', 'archived_at']
    list_filter = ['source', 'state', ('verified_at', admin.EmptyFieldListFilter)]
    search_fields = ['name', 'name_en', 'aliases', 'source_ref', 'barcode']
    inlines = [FoodPortionInline]
    actions = ['verify']

    @admin.action(description='Mark selected community foods as verified')
    def verify(self, request, queryset):
        # Row locks: an author's edit in flight finishes first, then the verification applies.
        with transaction.atomic():
            ids = list(queryset.filter(source=Food.Source.COMMUNITY, verified_at__isnull=True)
                       .select_for_update().values_list('pk', flat=True))
            Food.objects.filter(pk__in=ids).update(verified_at=timezone.now())


@admin.register(FoodReport)
class FoodReportAdmin(admin.ModelAdmin):
    list_display = ['food', 'reason', 'created_at', 'resolved_at']
    list_filter = [('resolved_at', admin.EmptyFieldListFilter)]
    raw_id_fields = ['food', 'reporter']
    actions = ['resolve']

    @admin.action(description='Mark selected reports as resolved')
    def resolve(self, request, queryset):
        queryset.filter(resolved_at__isnull=True).update(resolved_at=timezone.now())
