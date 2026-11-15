from django.urls import path

from . import views, recovery_views

urlpatterns = [
    path('password/reset/request/', recovery_views.PasswordResetRequestView.as_view()),
    path('password/reset/confirm/', recovery_views.PasswordResetConfirmView.as_view()),
    path('password/change/', recovery_views.PasswordChangeView.as_view()),
    path('email/verify/', recovery_views.EmailVerificationView.as_view()),
    path('email/resend/', recovery_views.EmailVerificationResendView.as_view()),
    path('register/', views.RegisterView.as_view()),
    path('login/', views.LoginView.as_view()),
    path('refresh/', views.RefreshView.as_view()),
    path('logout/', views.LogoutView.as_view()),
    path('me/', views.MeView.as_view()),
    path('me/onboarding/complete/', views.CompleteOnboardingView.as_view()),
    path('me/export/', views.ExportView.as_view()),
    path('me/delete/', views.DeleteAccountView.as_view()),
]
