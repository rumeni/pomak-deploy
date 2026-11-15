from django.contrib import admin
from django.urls import include, path

from core.health import health, ready
from accounts.cron import cleanup_auth_throttle_cron

urlpatterns = [
    path('api/health/', health, name='health'),
    path('api/internal/cleanup-auth-throttle/', cleanup_auth_throttle_cron, name='cleanup-auth-throttle'),
    path('api/ready/', ready, name='ready'),
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/coach/', include('coaching.urls')),
    path('api/progress/', include('progress.urls')),
    path('api/training/', include('training.urls')),
    path('api/nutrition/', include('nutrition.urls')),
]
