from django.contrib import admin

from .models import Exercise, Routine


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ['name', 'muscle', 'equipment', 'measurement', 'owner', 'archived_at']
    list_filter = ['muscle', 'equipment', 'measurement']
    search_fields = ['name', 'aliases']


@admin.register(Routine)
class RoutineAdmin(admin.ModelAdmin):
    list_display = ['name', 'owner', 'updated_at', 'archived_at']
    search_fields = ['name', 'owner__email']
