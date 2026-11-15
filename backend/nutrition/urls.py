from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import FoodViewSet, MealEntryView, NutritionDayView, RecentFoodsView, TargetEstimateView, TargetListView, TargetView, RecipeViewSet, SavedMealViewSet

router = DefaultRouter()
router.register('foods', FoodViewSet, basename='food')
router.register('recipes', RecipeViewSet, basename='recipe')
router.register('saved-meals', SavedMealViewSet, basename='saved-meal')

urlpatterns = router.urls + [
    path('entries/<uuid:entry_id>/', MealEntryView.as_view()),
    path('days/<str:day>/', NutritionDayView.as_view()),
    path('recent-foods/', RecentFoodsView.as_view()),
    path('targets/', TargetListView.as_view()),
    path('targets/estimate/', TargetEstimateView.as_view()),
    path('targets/<str:day>/', TargetView.as_view()),
]
