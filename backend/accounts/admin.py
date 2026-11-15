from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Profile, User


class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ['email']
    list_display = ['email', 'is_active', 'is_staff', 'date_joined']
    search_fields = ['email']
    inlines = [ProfileInline]
    fieldsets = [
        (None, {'fields': ['email', 'password']}),
        ('Dozvole', {'fields': ['is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions']}),
    ]
    add_fieldsets = [(None, {'classes': ['wide'], 'fields': ['email', 'password1', 'password2']})]
