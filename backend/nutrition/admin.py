from django.contrib import admin

from .models import Food, FoodPortion


class FoodPortionInline(admin.TabularInline):
    model = FoodPortion
    extra = 0


@admin.register(Food)
class FoodAdmin(admin.ModelAdmin):
    list_display = ['name', 'state', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source', 'owner', 'archived_at']
    list_filter = ['source', 'state']
    search_fields = ['name', 'name_en', 'aliases', 'source_ref']
    inlines = [FoodPortionInline]
