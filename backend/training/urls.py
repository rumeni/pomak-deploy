from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ExerciseProgressView, ExerciseViewSet, PerformedExercisesView, ProgramsView, RoutineViewSet, ScheduleView, StatsView,
    WorkoutSessionViewSet,
)

router = DefaultRouter()
router.register('exercises', ExerciseViewSet, basename='exercise')
router.register('routines', RoutineViewSet, basename='routine')
router.register('sessions', WorkoutSessionViewSet, basename='session')

urlpatterns = router.urls + [
    path('progress/exercises/', PerformedExercisesView.as_view()),
    path('stats/', StatsView.as_view()),
    path('programs/', ProgramsView.as_view()),
    path('schedule/', ScheduleView.as_view()),
    path('progress/exercises/<uuid:exercise_id>/', ExerciseProgressView.as_view()),
]
