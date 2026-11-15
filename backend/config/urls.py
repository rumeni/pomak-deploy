from django.contrib import admin
from django.urls import include, path

from core.health import health, ready

urlpatterns = [
    path('api/health/', health, name='health'),
    path('api/ready/', ready, name='ready'),
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/coach/', include('coaching.urls')),
    path('api/progress/', include('progress.urls')),
    path('api/training/', include('training.urls')),
    path('api/nutrition/', include('nutrition.urls')),
]
