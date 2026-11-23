from django.urls import path
from rest_framework.routers import DefaultRouter

from .photos import ProgressPhotoImageView, ProgressPhotosView, ProgressPhotoView
from .views import GoalViewSet, MeasurementViewSet, WeekReviewView, WeekView

router = DefaultRouter()
router.register('measurements', MeasurementViewSet, basename='measurement')
router.register('goals', GoalViewSet, basename='goal')

urlpatterns = router.urls + [
    path('week/', WeekView.as_view()),
    path('weeks/<str:day>/review/', WeekReviewView.as_view()),
    path('photos/', ProgressPhotosView.as_view()),
    path('photos/<uuid:pk>/', ProgressPhotoView.as_view()),
    path('photos/<uuid:pk>/image/', ProgressPhotoImageView.as_view()),
]
