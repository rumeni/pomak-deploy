"""Suggested programs by level (and a variant built for women), offered to everyone.

Each program is a set of routines the athlete copies into their own and can then change.
Sets, reps and target RPE grow with the level: beginners stay well away from failure
(RPE 6-7) with fewer sets; intermediate 7-8; advanced 8-9 with more volume.
`sex` only decides which programs are recommended first; all are visible to everyone.
"""

# Exercise entry: slug, working sets, rep range, target RPE (None: not prescribed), rest in seconds.
# Timed exercises (plank) use seconds in place of reps.
B, I, A = 'beginner', 'intermediate', 'advanced'


def ex(slug, sets, low, high, rpe, rest=90):
    return {'slug': slug, 'sets': sets, 'reps_min': low, 'reps_max': high, 'rpe': rpe, 'rest_seconds': rest}


PROGRAMS = [
    {
        'key': 'full-body-beginner', 'sex': 'male', 'level': B, 'days': 3,
        'name': {'sr': 'Celo telo za početnike', 'en': 'Full body for beginners'},
        'description': {
            'sr': 'Dva treninga celog tela (A i B) naizmenično, 3 puta nedeljno. Uči osnovne pokrete uz rezervu od 3-4 ponavljanja.',
            'en': 'Two full-body workouts (A and B) alternated, 3 times a week. Learn the main lifts with 3-4 reps in reserve.',
        },
        'routines': [
            {'name': {'sr': 'Celo telo A', 'en': 'Full body A'}, 'exercises': [
                ex('back-squat', 3, 8, 10, 6.5, 150), ex('bench-press', 3, 8, 10, 6.5, 120), ex('lat-pulldown', 3, 10, 12, 7),
                ex('dumbbell-shoulder-press', 2, 10, 12, 7), ex('plank', 2, 30, 45, None, 60),
            ]},
            {'name': {'sr': 'Celo telo B', 'en': 'Full body B'}, 'exercises': [
                ex('romanian-deadlift', 3, 8, 10, 6.5, 150), ex('incline-dumbbell-press', 3, 10, 12, 7), ex('seated-cable-row', 3, 10, 12, 7),
                ex('leg-press', 2, 12, 12, 7), ex('crunch', 2, 15, 15, None, 60),
            ]},
        ],
    },
    {
        'key': 'split-intermediate', 'sex': 'male', 'level': I, 'days': 3,
        'name': {'sr': 'Grudi i triceps · Leđa i biceps · Noge i ramena', 'en': 'Chest & triceps · Back & biceps · Legs & shoulders'},
        'description': {
            'sr': 'Klasičan split na 3 dana. Svaka mišićna grupa jednom nedeljno, više serija po grupi, RPE 7-8.',
            'en': 'A classic 3-day split. Each muscle group once a week with more sets per group, RPE 7-8.',
        },
        'routines': [
            {'name': {'sr': 'Grudi i triceps', 'en': 'Chest & triceps'}, 'exercises': [
                ex('bench-press', 4, 6, 8, 7.5, 150), ex('incline-dumbbell-press', 3, 8, 10, 8, 120), ex('cable-crossover', 3, 12, 15, 8),
                ex('dips', 3, 8, 12, 8), ex('triceps-pushdown', 3, 10, 12, 8, 75), ex('overhead-triceps-extension', 3, 12, 15, 8, 75),
            ]},
            {'name': {'sr': 'Leđa i biceps', 'en': 'Back & biceps'}, 'exercises': [
                ex('deadlift', 3, 5, 5, 7.5, 180), ex('lat-pulldown', 4, 8, 10, 8), ex('barbell-row', 3, 8, 10, 8, 120),
                ex('seated-cable-row', 3, 10, 12, 8), ex('barbell-curl', 3, 8, 10, 8, 75), ex('hammer-curl', 3, 10, 12, 8, 75),
            ]},
            {'name': {'sr': 'Noge i ramena', 'en': 'Legs & shoulders'}, 'exercises': [
                ex('back-squat', 4, 6, 8, 7.5, 180), ex('romanian-deadlift', 3, 8, 10, 7.5, 150), ex('leg-press', 3, 10, 12, 8, 120),
                ex('leg-curl', 3, 10, 12, 8), ex('overhead-press', 3, 6, 8, 7.5, 150), ex('lateral-raise', 3, 12, 15, 8, 60),
                ex('calf-raise', 3, 12, 15, 8, 60),
            ]},
        ],
    },
    {
        'key': 'ppl-advanced', 'sex': 'male', 'level': A, 'days': 6,
        'name': {'sr': 'Push · Pull · Legs (2× nedeljno)', 'en': 'Push · Pull · Legs (twice a week)'},
        'description': {
            'sr': 'Svaka grupa dva puta nedeljno, 6 dana. Veći obim i RPE 8-9; za one koji se dobro oporavljaju.',
            'en': 'Each group twice a week over 6 days. Higher volume and RPE 8-9; for those who recover well.',
        },
        'routines': [
            {'name': {'sr': 'Push (grudi, ramena, triceps)', 'en': 'Push (chest, shoulders, triceps)'}, 'exercises': [
                ex('bench-press', 5, 5, 6, 8, 180), ex('overhead-press', 4, 6, 8, 8, 150), ex('incline-dumbbell-press', 4, 8, 10, 8.5, 120),
                ex('lateral-raise', 4, 12, 15, 9, 60), ex('dips', 3, 8, 12, 8.5), ex('triceps-pushdown', 3, 10, 12, 9, 60),
            ]},
            {'name': {'sr': 'Pull (leđa, biceps)', 'en': 'Pull (back, biceps)'}, 'exercises': [
                ex('deadlift', 4, 4, 5, 8, 210), ex('weighted-pull-up', 4, 6, 8, 8.5, 150), ex('barbell-row', 4, 8, 10, 8.5, 120),
                ex('face-pull', 3, 12, 15, 8, 60), ex('barbell-curl', 4, 8, 10, 9, 75), ex('hammer-curl', 3, 10, 12, 9, 60),
            ]},
            {'name': {'sr': 'Legs (noge)', 'en': 'Legs'}, 'exercises': [
                ex('back-squat', 5, 5, 6, 8, 210), ex('romanian-deadlift', 4, 6, 8, 8, 150), ex('bulgarian-split-squat', 3, 8, 10, 8.5, 120),
                ex('leg-curl', 4, 10, 12, 9), ex('leg-extension', 3, 12, 15, 9, 60), ex('calf-raise', 4, 10, 15, 9, 60),
            ]},
        ],
    },
    {
        'key': 'full-body-lower-beginner', 'sex': 'female', 'level': B, 'days': 3,
        'name': {'sr': 'Celo telo sa naglaskom na donji deo (početnice)', 'en': 'Full body, lower-body focus (beginners)'},
        'description': {
            'sr': 'Dva treninga celog tela, 3 puta nedeljno, više vežbi za noge i gluteus. RPE 6-7, tehnika na prvom mestu.',
            'en': 'Two full-body workouts, 3 times a week, with more leg and glute work. RPE 6-7, technique first.',
        },
        'routines': [
            {'name': {'sr': 'Celo telo A', 'en': 'Full body A'}, 'exercises': [
                ex('goblet-squat', 3, 10, 12, 6.5, 120), ex('hip-thrust', 3, 10, 12, 7, 120), ex('lat-pulldown', 3, 10, 12, 7),
                ex('dumbbell-shoulder-press', 2, 10, 12, 7), ex('plank', 2, 30, 45, None, 60),
            ]},
            {'name': {'sr': 'Celo telo B', 'en': 'Full body B'}, 'exercises': [
                ex('romanian-deadlift', 3, 10, 12, 6.5, 120), ex('glute-bridge', 3, 12, 15, 7, 60), ex('dumbbell-lunge', 2, 10, 12, 7),
                ex('seated-cable-row', 3, 10, 12, 7), ex('hip-abduction', 2, 15, 20, 7, 60), ex('crunch', 2, 15, 15, None, 60),
            ]},
        ],
    },
    {
        'key': 'glutes-upper-quads-intermediate', 'sex': 'female', 'level': I, 'days': 3,
        'name': {'sr': 'Gluteus · Gornji deo · Kvadriceps', 'en': 'Glutes · Upper body · Quads'},
        'description': {
            'sr': 'Tri dana: dan za gluteus i zadnju ložu, dan za gornji deo i trbuh, dan za prednji deo nogu. RPE 7-8.',
            'en': 'Three days: glutes and hamstrings, upper body and core, front of the legs. RPE 7-8.',
        },
        'routines': [
            {'name': {'sr': 'Donji deo: gluteus', 'en': 'Lower body: glutes'}, 'exercises': [
                ex('hip-thrust', 4, 8, 10, 8, 150), ex('romanian-deadlift', 3, 8, 10, 7.5, 150), ex('bulgarian-split-squat', 3, 10, 12, 8, 90),
                ex('cable-kickback', 3, 12, 15, 8, 60), ex('hip-abduction', 3, 15, 20, 8, 60),
            ]},
            {'name': {'sr': 'Gornji deo i trbuh', 'en': 'Upper body & core'}, 'exercises': [
                ex('lat-pulldown', 3, 10, 12, 8), ex('dumbbell-shoulder-press', 3, 10, 12, 8), ex('seated-cable-row', 3, 10, 12, 8),
                ex('incline-dumbbell-press', 3, 10, 12, 8), ex('triceps-pushdown', 2, 12, 15, 8, 60), ex('dumbbell-curl', 2, 12, 15, 8, 60),
                ex('hanging-leg-raise', 3, 8, 12, None, 60),
            ]},
            {'name': {'sr': 'Donji deo: kvadriceps', 'en': 'Lower body: quads'}, 'exercises': [
                ex('back-squat', 4, 6, 8, 7.5, 180), ex('leg-press', 3, 10, 12, 8, 120), ex('step-up', 3, 10, 12, 8),
                ex('leg-extension', 3, 12, 15, 8, 60), ex('leg-curl', 3, 10, 12, 8, 60), ex('calf-raise', 3, 12, 15, 8, 60),
            ]},
        ],
    },
    {
        'key': 'lower-upper-advanced-women', 'sex': 'female', 'level': A, 'days': 4,
        'name': {'sr': 'Gluteus · Kvadriceps · Gornji deo · Celo telo (4 dana)', 'en': 'Glutes · Quads · Upper · Full body (4 days)'},
        'description': {
            'sr': 'Četiri dana sa donjim delom dva puta nedeljno, težim osnovnim vežbama i RPE 8-9.',
            'en': 'Four days with the lower body twice a week, heavier main lifts and RPE 8-9.',
        },
        'routines': [
            {'name': {'sr': 'Gluteus (teško)', 'en': 'Glutes (heavy)'}, 'exercises': [
                ex('hip-thrust', 5, 6, 8, 8.5, 150), ex('sumo-deadlift', 4, 5, 6, 8, 180), ex('bulgarian-split-squat', 3, 8, 10, 8.5),
                ex('cable-kickback', 3, 12, 15, 9, 60), ex('hip-abduction', 3, 15, 20, 9, 60),
            ]},
            {'name': {'sr': 'Kvadriceps', 'en': 'Quads'}, 'exercises': [
                ex('back-squat', 5, 5, 6, 8, 180), ex('leg-press', 4, 8, 10, 8.5, 120), ex('step-up', 3, 10, 12, 8.5),
                ex('leg-extension', 3, 12, 15, 9, 60), ex('calf-raise', 4, 12, 15, 9, 60),
            ]},
            {'name': {'sr': 'Gornji deo', 'en': 'Upper body'}, 'exercises': [
                ex('pull-up', 4, 6, 10, 8.5, 120), ex('overhead-press', 4, 6, 8, 8, 150), ex('dumbbell-row', 3, 8, 10, 8.5),
                ex('incline-dumbbell-press', 3, 8, 10, 8.5), ex('lateral-raise', 3, 12, 15, 9, 60), ex('face-pull', 3, 12, 15, 8, 60),
            ]},
            {'name': {'sr': 'Celo telo', 'en': 'Full body'}, 'exercises': [
                ex('romanian-deadlift', 4, 8, 10, 8, 150), ex('goblet-squat', 3, 10, 12, 8), ex('glute-bridge', 3, 12, 15, 8.5, 60),
                ex('lat-pulldown', 3, 10, 12, 8.5), ex('ab-wheel', 3, 8, 12, None, 60),
            ]},
        ],
    },
]

LEVEL_ORDER = {B: 0, I: 1, A: 2}
