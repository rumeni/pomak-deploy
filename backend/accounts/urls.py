from django.urls import path

from . import views

urlpatterns = [
    path('register/', views.RegisterView.as_view()),
    path('login/', views.LoginView.as_view()),
    path('refresh/', views.RefreshView.as_view()),
    path('logout/', views.LogoutView.as_view()),
    path('me/', views.MeView.as_view()),
    path('me/onboarding/complete/', views.CompleteOnboardingView.as_view()),
    path('me/export/', views.ExportView.as_view()),
    path('me/delete/', views.DeleteAccountView.as_view()),
]
