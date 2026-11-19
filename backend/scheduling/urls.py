from django.urls import path

from . import views

urlpatterns = [
    path('settings/', views.SettingsView.as_view(), name='schedule-settings'),
    path('session-types/', views.SessionTypesView.as_view(), name='schedule-session-types'),
    path('session-types/<uuid:pk>/', views.SessionTypeView.as_view(), name='schedule-session-type'),
    path('hours/', views.HoursView.as_view(), name='schedule-hours'),
    path('exceptions/', views.ExceptionsView.as_view(), name='schedule-exceptions'),
    path('exceptions/<uuid:pk>/', views.ExceptionView.as_view(), name='schedule-exception'),
    path('calendar/', views.CalendarView.as_view(), name='schedule-calendar'),
    path('slots/', views.SlotsView.as_view(), name='schedule-slots'),
    path('bookings/', views.BookingsView.as_view(), name='schedule-bookings'),
    path('bookings/<uuid:pk>/confirm/', views.BookingActionView.as_view(action='confirm'), name='schedule-booking-confirm'),
    path('bookings/<uuid:pk>/decline/', views.BookingActionView.as_view(action='decline'), name='schedule-booking-decline'),
    path('bookings/<uuid:pk>/cancel/', views.BookingActionView.as_view(action='cancel'), name='schedule-booking-cancel'),
]
