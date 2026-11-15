from django.urls import path

from . import views

urlpatterns = [
    path('dashboard/', views.DashboardView.as_view(), name='coach-dashboard'),
    path('invitations/', views.InvitationCreateView.as_view(), name='coach-invitations'),
    path('invitations/<uuid:pk>/', views.InvitationRevokeView.as_view(), name='coach-revoke-invitation'),
    path('connect/', views.ConnectView.as_view(), name='coach-connect'),
    path('connection/', views.ConnectionView.as_view(), name='coach-connection'),
    path('clients/<uuid:client_id>/', views.CoachClientView.as_view(), name='coach-client'),
    path('clients/<uuid:client_id>/assign/', views.AssignRoutineView.as_view(), name='coach-assign-routine'),
    path('messages/', views.MessagesView.as_view(), name='coach-messages'),
]
