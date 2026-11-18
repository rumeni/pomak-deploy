from django.urls import path

from . import views

urlpatterns = [
    path('dashboard/', views.DashboardView.as_view(), name='coach-dashboard'),
    path('profile/', views.CoachProfileView.as_view(), name='coach-profile'),
    path('invitations/', views.InvitationCreateView.as_view(), name='coach-invitations'),
    path('invitations/preview/', views.InvitationPreviewView.as_view(), name='coach-invitation-preview'),
    path('invitations/<uuid:pk>/', views.InvitationRevokeView.as_view(), name='coach-revoke-invitation'),
    path('connect/', views.ConnectView.as_view(), name='coach-connect'),
    path('connection/', views.ConnectionView.as_view(), name='coach-connection'),
    path('clients/<uuid:client_id>/', views.CoachClientView.as_view(), name='coach-client'),
    path('clients/<uuid:client_id>/assign/', views.AssignRoutineView.as_view(), name='coach-assign-routine'),
    path('connections/<uuid:connection_id>/notes/', views.NotesView.as_view(), name='coach-notes'),
    path('notes/<uuid:pk>/', views.NoteView.as_view(), name='coach-note'),
    path('tasks/', views.TasksView.as_view(), name='coach-tasks'),
    path('tasks/<uuid:pk>/', views.TaskView.as_view(), name='coach-task'),
    path('conversations/', views.ConversationsView.as_view(), name='coach-conversations'),
    path('messages/', views.MessagesView.as_view(), name='coach-messages'),
]
