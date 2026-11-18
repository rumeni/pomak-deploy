from django.urls import path

from . import views

urlpatterns = [
    path('config/', views.PushConfigView.as_view(), name='push-config'),
    path('devices/', views.DevicesView.as_view(), name='push-devices'),
    path('devices/remove/', views.DeviceRemoveView.as_view(), name='push-device-remove'),
]
