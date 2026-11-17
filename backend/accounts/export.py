"""Izvoz svih podataka korisnika: ZIP sa pomak.json (sve) i CSV tabelama (treninzi, ishrana, merenja).

JSON je potpun i mašinski čitljiv; CSV su za tabele (Excel, Google Sheets). Decimale su sa tačkom.
"""

import csv
import io
import json
import zipfile

from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Prefetch, Q
from django.utils import timezone

from nutrition.models import Food, MealEntry, NutritionDay, NutritionTarget, SavedMeal
from coaching.models import CoachConnection, CoachMessage, CoachAssignment
from progress.models import Goal, Measurement
from training.models import Exercise, Routine, SessionExercise, WorkoutSession

PROFILE_FIELDS = [
    'display_name', 'language', 'is_coach', 'tracks_training', 'tracks_nutrition', 'training_experience',
    'weekly_workouts_target', 'sex', 'birth_date', 'height_cm', 'meals',
]
SET_FIELDS = ['set_type', 'weight_kg', 'reps', 'duration_seconds', 'distance_m', 'rpe', 'completed_at']
READINESS_EXPORT = ['sleep_hours', 'hydration', 'stress', 'motivation', 'soreness_upper', 'soreness_lower']
READINESS_CSV = ['sleep_hours', 'motivation', 'stress', 'soreness_upper', 'soreness_lower', 'hydration']
VALUE_FIELDS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']


def _sets(queryset, fields):
    return [{f: getattr(s, f) for f in fields} for s in queryset]


def collect(user) -> dict:
    profile = user.profile
    sessions = WorkoutSession.objects.filter(owner=user).order_by('started_at').prefetch_related(
        Prefetch('exercises', queryset=SessionExercise.objects.select_related('exercise').prefetch_related('sets')),
    )
    routines = Routine.objects.filter(owner=user).prefetch_related('exercises__exercise', 'exercises__sets')
    foods = Food.objects.filter(owner=user).prefetch_related('portions', 'ingredients__food')
    connections = CoachConnection.objects.filter(Q(client=user) | Q(coach=user)).select_related('coach__profile', 'client__profile')
    return {
        'exported_at': timezone.now(),
        'coaching': {
            'connections': [
                {'coach': c.coach.profile.display_name or c.coach.email.split('@')[0], 'client': c.client.profile.display_name or c.client.email.split('@')[0],
                 'share_measurements': c.share_measurements, 'share_nutrition': c.share_nutrition, 'connected_at': c.created_at}
                for c in connections
            ],
            'messages': [
                {'sender_role': 'coach' if m.sender_id == m.connection.coach_id else 'client',
                 'text': m.text, 'created_at': m.created_at}
                for m in CoachMessage.objects.filter(connection__in=connections).select_related('connection').order_by('created_at')
            ],
            'assigned_routines': list(CoachAssignment.objects.filter(connection__client=user).values('routine__name', 'created_at')),
        },
        'account': {'email': user.email, 'date_joined': user.date_joined, 'profile': {f: getattr(profile, f) for f in PROFILE_FIELDS}},
        'measurements': list(Measurement.objects.filter(user=user).order_by('measured_on').values('kind', 'value', 'measured_on', 'note')),
        'goals': list(Goal.objects.filter(user=user).values(
            'kind', 'start_value', 'target_value', 'start_date', 'target_date', 'status', 'closed_on',
        )),
        'custom_exercises': list(Exercise.objects.filter(owner=user).values('id', 'name', 'equipment', 'measurement', 'load_mode', 'muscle', 'archived_at')),
        'routines': [
            {
                'name': r.name, 'notes': r.notes, 'archived_at': r.archived_at,
                'exercises': [
                    {
                        'exercise': e.exercise.name, 'rest_seconds': e.rest_seconds, 'notes': e.notes,
                        'sets': _sets(e.sets.all(), ['set_type', 'reps_min', 'reps_max', 'weight_kg', 'duration_seconds', 'distance_m', 'rpe']),
                    }
                    for e in r.exercises.all()
                ],
            }
            for r in routines
        ],
        'workouts': [
            {
                'name': s.name, 'started_at': s.started_at, 'finished_at': s.finished_at, 'feeling': s.feeling, 'notes': s.notes,
                'readiness': {f: getattr(s, f) for f in READINESS_EXPORT},
                'exercises': [
                    {'exercise': e.exercise.name, 'notes': e.notes, 'sets': _sets(e.sets.all(), SET_FIELDS)} for e in s.exercises.all()
                ],
            }
            for s in sessions
        ],
        'nutrition': {
            'entries': list(MealEntry.objects.filter(owner=user).order_by('date', 'created_at').values(
                'date', 'meal', 'name', 'grams', 'portion_name', *VALUE_FIELDS,
            )),
            'days': list(NutritionDay.objects.filter(owner=user).order_by('date').values('date', 'status')),
            'targets': list(NutritionTarget.objects.filter(owner=user).order_by('valid_from').values(
                'valid_from', 'mode', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'method', 'inputs', 'explanation',
            )),
            'foods_and_recipes': [
                {
                    'name': f.name, 'source': f.source, 'state': f.state, 'archived_at': f.archived_at,
                    'per_100g': {v: getattr(f, v) for v in VALUE_FIELDS},
                    'portions': [{'name': p.name, 'grams': p.grams} for p in f.portions.all()],
                    'recipe_mass_g': f.recipe_mass_g,
                    'recipe_servings': f.recipe_servings,
                    'ingredients': [{'food': i.food.name, 'grams': i.grams} for i in f.ingredients.all()],
                }
                for f in foods
            ],
            'saved_meals': [
                {'name': m.name, 'items': list(m.items.values('food__name', 'grams', 'portion_name', 'name', *VALUE_FIELDS))}
                for m in SavedMeal.objects.filter(owner=user)
            ],
        },
    }


def _csv(header, rows) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerows(rows)
    # BOM da Excel prepozna UTF-8 (š, đ, č).
    return '﻿' + out.getvalue()


def build_zip(user) -> bytes:
    data = collect(user)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('pomak.json', json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False, indent=2))
        z.writestr('treninzi.csv', _csv(
            ['datum', 'trening', 'vezba', 'serija', 'vrsta', 'tezina_kg', 'ponavljanja', 'trajanje_s', 'distanca_m', 'rpe'],
            [
                [timezone.localtime(w['started_at']).date(), w['name'], e['exercise'], i + 1, s['set_type'],
                 s['weight_kg'], s['reps'], s['duration_seconds'], s['distance_m'], s['rpe']]
                for w in data['workouts'] for e in w['exercises'] for i, s in enumerate(e['sets'])
            ],
        ))
        # Pre-workout check-in: one row per workout that has one (1-5 scales, sleep in hours).
        z.writestr('spremnost.csv', _csv(
            ['datum', 'trening', 'san_h', 'motivacija', 'stres', 'upala_gornji_deo', 'upala_donji_deo', 'hidratacija'],
            [
                [timezone.localtime(w['started_at']).date(), w['name'], *[w['readiness'][f] for f in READINESS_CSV]]
                for w in data['workouts'] if any(v is not None for v in w['readiness'].values())
            ],
        ))
        z.writestr('ishrana.csv', _csv(
            ['datum', 'obrok', 'naziv', 'grami', 'kcal', 'proteini_g', 'uh_g', 'masti_g', 'vlakna_g'],
            [[e['date'], e['meal'], e['name'], e['grams'], *[e[v] for v in VALUE_FIELDS]] for e in data['nutrition']['entries']],
        ))
        z.writestr('merenja.csv', _csv(
            ['datum', 'vrsta', 'vrednost', 'napomena'],
            [[m['measured_on'], m['kind'], m['value'], m['note']] for m in data['measurements']],
        ))
    return buffer.getvalue()
