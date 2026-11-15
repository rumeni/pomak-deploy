"""Napredak u vežbi: lični rekordi i jedna vrednost po treningu za grafikon.

Računaju se samo radne serije (zagrevanje ne). Šta je rekord zavisi od načina merenja vežbe:
- težina × ponavljanja: najveća težina, najbolji procenjeni 1RM, najveći obim serije i treninga
- sopstvena težina (i uz pomoć): najviše ponavljanja u seriji i na treningu
- trajanje: najduže; distanca: najduža distanca i najduže trajanje

Procenjeni 1RM = težina × (1 + ponavljanja / 30) (Epley 1985), samo za 1–10 ponavljanja,
jer je procena za više ponavljanja nepouzdana. Prikazuje se kao procena.
"""

from decimal import Decimal

from django.utils import timezone

from .models import Exercise, RoutineSet

WEIGHTED = {Exercise.Measurement.WEIGHT_REPS, Exercise.Measurement.WEIGHTED_BODYWEIGHT}
REPS_ONLY = {Exercise.Measurement.BODYWEIGHT_REPS, Exercise.Measurement.ASSISTED_BODYWEIGHT}
MAX_E1RM_REPS = 10


def epley(weight: Decimal, reps: int) -> Decimal:
    return weight if reps == 1 else weight * (1 + Decimal(reps) / 30)


def _json(value):
    """Decimal kao tekst ("80.00"), kao i u ostatku API-ja."""
    return str(value) if isinstance(value, Decimal) else value


def _record(value, session, **extra) -> dict:
    return {'value': value, 'date': timezone.localdate(session.started_at), 'session_id': session.id, **extra}


def analyze(measurement: str, session_exercises) -> dict:
    """`session_exercises`: SessionExercise sa učitanim session i sets, od najstarijeg ka najnovijem."""
    records: dict[str, dict] = {}
    points = []

    def better(key, value, session, **extra):
        # Pri istoj vrednosti ostaje raniji rekord (datum kad je prvi put postignut).
        if value is not None and (key not in records or value > records[key]['value']):
            records[key] = _record(value, session, **extra)

    for se in session_exercises:
        session = se.session
        sets = [s for s in se.sets.all() if s.set_type == RoutineSet.SetType.WORKING]
        if not sets:
            continue
        point = None
        if measurement in WEIGHTED:
            loaded = [s for s in sets if s.weight_kg is not None and s.reps]
            for s in loaded:
                better('heaviest', s.weight_kg, session, reps=s.reps)
                better('best_set_volume', s.weight_kg * s.reps, session, weight=s.weight_kg, reps=s.reps)
                if s.reps <= MAX_E1RM_REPS and s.weight_kg > 0:
                    better('e1rm', epley(s.weight_kg, s.reps).quantize(Decimal('0.1')), session, weight=s.weight_kg, reps=s.reps)
            if loaded:
                better('session_volume', sum(s.weight_kg * s.reps for s in loaded), session)
                point = max(s.weight_kg for s in loaded)
        elif measurement in REPS_ONLY:
            reps = [s.reps for s in sets if s.reps]
            if reps:
                better('most_reps', max(reps), session)
                better('session_reps', sum(reps), session)
                point = max(reps)
        elif measurement == Exercise.Measurement.DURATION:
            durations = [s.duration_seconds for s in sets if s.duration_seconds]
            if durations:
                better('longest_duration', max(durations), session)
                point = max(durations)
        else:
            distances = [s.distance_m for s in sets if s.distance_m]
            durations = [s.duration_seconds for s in sets if s.duration_seconds]
            if distances:
                better('longest_distance', max(distances), session)
                point = max(distances)
            if durations:
                better('longest_duration', max(durations), session)
        if point is not None:
            points.append({'date': timezone.localdate(session.started_at), 'value': point})

    metric = {
        **{m: 'heaviest' for m in WEIGHTED},
        **{m: 'most_reps' for m in REPS_ONLY},
        Exercise.Measurement.DURATION: 'longest_duration',
        Exercise.Measurement.DISTANCE_DURATION: 'longest_distance',
    }[measurement]
    return {
        'records': {key: {k: _json(v) for k, v in r.items()} for key, r in records.items()},
        'chart': {'metric': metric, 'points': [{**p, 'value': _json(p['value'])} for p in points]},
    }
