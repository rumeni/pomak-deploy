from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import GoalViewSet, MeasurementViewSet, WeekReviewView, WeekView

router = DefaultRouter()
router.register('measurements', MeasurementViewSet, basename='measurement')
router.register('goals', GoalViewSet, basename='goal')

urlpatterns = router.urls + [path('week/', WeekView.as_view()), path('weeks/<str:day>/review/', WeekReviewView.as_view())]
