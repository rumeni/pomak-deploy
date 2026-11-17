"""Početna zajednička biblioteka vežbi.

Svaka vežba: (slug, naziv, drugi nazivi, oprema, vrsta merenja, mišićna grupa, način unosa težine).
Slug se ne menja kad jednom uđe u bazu; po njemu se kasnije ažurira ista vežba.
"""

W = 'weight_reps'
BW = 'bodyweight_reps'
WBW = 'weighted_bodyweight'
ABW = 'assisted_bodyweight'
DUR = 'duration'
DIST = 'distance_duration'

TOTAL = 'total'
SIDE = 'per_side'

EXERCISES = [
    # Grudi
    ('bench-press', 'Potisak sa ravne klupe (šipka)', 'bench press, benč, bench', 'barbell', W, 'chest', TOTAL),
    ('incline-bench-press', 'Potisak sa kose klupe (šipka)', 'incline bench press, kosi benč', 'barbell', W, 'chest', TOTAL),
    ('dumbbell-bench-press', 'Potisak sa ravne klupe (bučice)', 'dumbbell bench press, benč bučice', 'dumbbell', W, 'chest', SIDE),
    ('incline-dumbbell-press', 'Potisak sa kose klupe (bučice)', 'incline dumbbell press', 'dumbbell', W, 'chest', SIDE),
    ('dumbbell-fly', 'Razvlačenje bučicama na klupi', 'dumbbell fly, razvlačenje', 'dumbbell', W, 'chest', SIDE),
    ('cable-crossover', 'Razvlačenje na sajli', 'cable crossover, cable fly, kros', 'cable', W, 'chest', TOTAL),
    ('pec-deck', 'Butterfly sprava', 'pec deck, butterfly, leptir', 'machine', W, 'chest', TOTAL),
    ('push-up', 'Sklekovi', 'push up, sklek, pumpanje', 'bodyweight', BW, 'chest', TOTAL),
    ('dips', 'Propadanja na razboju', 'dips, propadanje, razboj', 'bodyweight', BW, 'triceps', TOTAL),
    # Leđa
    ('pull-up', 'Zgibovi', 'pull up, zgib', 'bodyweight', BW, 'back', TOTAL),
    ('weighted-pull-up', 'Zgibovi sa dodatnim teretom', 'weighted pull up, zgib sa tegom', 'bodyweight', WBW, 'back', TOTAL),
    ('assisted-pull-up', 'Zgibovi uz pomoć sprave', 'assisted pull up, zgib sa pomoći', 'machine', ABW, 'back', TOTAL),
    ('barbell-row', 'Veslanje šipkom u pretklonu', 'barbell row, bent over row, veslanje', 'barbell', W, 'back', TOTAL),
    ('dumbbell-row', 'Veslanje bučicom jednom rukom', 'one arm dumbbell row, veslanje bučicom', 'dumbbell', W, 'back', SIDE),
    ('lat-pulldown', 'Vuča sajle ka grudima', 'lat pulldown, lat mašina, vuča', 'cable', W, 'back', TOTAL),
    ('seated-cable-row', 'Veslanje na sajli sedeći', 'seated cable row, veslanje sajla', 'cable', W, 'back', TOTAL),
    ('deadlift', 'Mrtvo dizanje', 'deadlift, mrtvo', 'barbell', W, 'back', TOTAL),
    ('back-extension', 'Hiperekstenzije', 'back extension, hyperextension, leđni', 'bodyweight', BW, 'back', TOTAL),
    # Ramena
    ('overhead-press', 'Potisak iznad glave (šipka)', 'overhead press, military press, OHP, vojnički potisak', 'barbell', W, 'shoulders', TOTAL),
    ('dumbbell-shoulder-press', 'Potisak iznad glave (bučice)', 'dumbbell shoulder press, rame potisak', 'dumbbell', W, 'shoulders', SIDE),
    ('lateral-raise', 'Odručenje bučicama', 'lateral raise, bočno podizanje, odručenje', 'dumbbell', W, 'shoulders', SIDE),
    ('front-raise', 'Predručenje bučicama', 'front raise, prednje podizanje', 'dumbbell', W, 'shoulders', SIDE),
    ('rear-delt-fly', 'Odručenje u pretklonu', 'rear delt fly, reverse fly, zadnje rame', 'dumbbell', W, 'shoulders', SIDE),
    ('face-pull', 'Face pull na sajli', 'face pull, vuča ka licu', 'cable', W, 'shoulders', TOTAL),
    ('shrug', 'Slegovanje ramenima', 'shrug, šrag, trapez', 'dumbbell', W, 'shoulders', SIDE),
    # Ruke
    ('barbell-curl', 'Pregib sa šipkom', 'barbell curl, biceps šipka', 'barbell', W, 'biceps', TOTAL),
    ('dumbbell-curl', 'Pregib sa bučicama', 'dumbbell curl, biceps bučice', 'dumbbell', W, 'biceps', SIDE),
    ('hammer-curl', 'Čekić pregib', 'hammer curl, čekić', 'dumbbell', W, 'biceps', SIDE),
    ('preacher-curl', 'Pregib na Skotovoj klupi', 'preacher curl, skot klupa', 'barbell', W, 'biceps', TOTAL),
    ('triceps-pushdown', 'Opružanje na sajli (triceps)', 'triceps pushdown, sajla triceps', 'cable', W, 'triceps', TOTAL),
    ('skull-crusher', 'Francuski potisak', 'skull crusher, french press, francuski', 'barbell', W, 'triceps', TOTAL),
    ('overhead-triceps-extension', 'Opružanje iznad glave (bučica)', 'overhead triceps extension', 'dumbbell', W, 'triceps', TOTAL),
    # Noge i gluteus
    ('back-squat', 'Čučanj sa šipkom', 'squat, back squat, čučanj', 'barbell', W, 'legs', TOTAL),
    ('front-squat', 'Prednji čučanj', 'front squat', 'barbell', W, 'legs', TOTAL),
    ('goblet-squat', 'Goblet čučanj', 'goblet squat', 'dumbbell', W, 'legs', TOTAL),
    ('leg-press', 'Potisak nogama', 'leg press, nožna presa, prese', 'machine', W, 'legs', TOTAL),
    ('dumbbell-lunge', 'Iskoraci sa bučicama', 'lunges, iskorak, iskoraci', 'dumbbell', W, 'legs', SIDE),
    ('bulgarian-split-squat', 'Bugarski čučanj', 'bulgarian split squat, bugarski', 'dumbbell', W, 'legs', SIDE),
    ('romanian-deadlift', 'Rumunsko mrtvo dizanje', 'romanian deadlift, RDL, rumunsko', 'barbell', W, 'legs', TOTAL),
    ('leg-extension', 'Opružanje nogu na spravi', 'leg extension, ekstenzije, kvadriceps', 'machine', W, 'legs', TOTAL),
    ('leg-curl', 'Pregib nogu na spravi', 'leg curl, zadnja loža, fleksija', 'machine', W, 'legs', TOTAL),
    ('hip-thrust', 'Podizanje karlice sa šipkom', 'hip thrust, glute bridge, most', 'barbell', W, 'glutes', TOTAL),
    ('glute-bridge', 'Glute bridge (most sa poda)', 'glute bridge, most, podizanje karlice sa poda', 'bodyweight', WBW, 'glutes', TOTAL),
    ('hip-abduction', 'Abdukcija kukova na spravi', 'hip abduction, abduktor, odvođenje nogu', 'machine', W, 'glutes', TOTAL),
    ('cable-kickback', 'Zamah nogom unazad na sajli', 'cable kickback, glute kickback, zamah nogom', 'cable', W, 'glutes', TOTAL),
    ('step-up', 'Penjanje na klupu sa bučicama', 'step up, penjanje, iskorak na klupu', 'dumbbell', W, 'legs', SIDE),
    ('sumo-deadlift', 'Sumo mrtvo dizanje', 'sumo deadlift, sumo', 'barbell', W, 'glutes', TOTAL),
    ('calf-raise', 'Podizanje na prste', 'calf raise, listovi, list', 'machine', W, 'legs', TOTAL),
    ('kettlebell-swing', 'Zamah girjom', 'kettlebell swing, girja', 'kettlebell', W, 'full_body', TOTAL),
    # Trbuh
    ('plank', 'Plank (izdržaj)', 'plank, izdržaj, daska', 'bodyweight', DUR, 'core', TOTAL),
    ('crunch', 'Trbušnjaci', 'crunch, krančevi, trbušnjaci', 'bodyweight', BW, 'core', TOTAL),
    ('hanging-leg-raise', 'Podizanje nogu u visu', 'hanging leg raise, noge u visu', 'bodyweight', BW, 'core', TOTAL),
    ('ab-wheel', 'Točak za trbušnjake', 'ab wheel, ab rollout, točak', 'other', BW, 'core', TOTAL),
    # Kardio
    ('treadmill-run', 'Trčanje na traci', 'treadmill, trčanje, traka', 'machine', DIST, 'cardio', TOTAL),
    ('incline-walk', 'Hodanje na traci pod nagibom', 'incline walk, hodanje, nagib', 'machine', DIST, 'cardio', TOTAL),
    ('stationary-bike', 'Sobni bicikl', 'stationary bike, bicikl, spinning', 'machine', DIST, 'cardio', TOTAL),
    ('rowing-machine', 'Veslački ergometar', 'rowing machine, veslanje, ergometar', 'machine', DIST, 'cardio', TOTAL),
    ('jump-rope', 'Preskakanje vijače', 'jump rope, vijača, konopac', 'other', DUR, 'cardio', TOTAL),
]

# Nazivi na engleskom (po slug-u), za aplikaciju podešenu na engleski.
NAMES_EN = {
    'bench-press': 'Bench Press (Barbell)',
    'incline-bench-press': 'Incline Bench Press (Barbell)',
    'dumbbell-bench-press': 'Bench Press (Dumbbell)',
    'incline-dumbbell-press': 'Incline Bench Press (Dumbbell)',
    'dumbbell-fly': 'Dumbbell Fly',
    'cable-crossover': 'Cable Crossover',
    'pec-deck': 'Pec Deck',
    'push-up': 'Push-Up',
    'dips': 'Dips',
    'pull-up': 'Pull-Up',
    'weighted-pull-up': 'Weighted Pull-Up',
    'assisted-pull-up': 'Assisted Pull-Up (Machine)',
    'barbell-row': 'Bent Over Row (Barbell)',
    'dumbbell-row': 'One Arm Row (Dumbbell)',
    'lat-pulldown': 'Lat Pulldown (Cable)',
    'seated-cable-row': 'Seated Cable Row',
    'deadlift': 'Deadlift (Barbell)',
    'back-extension': 'Back Extension',
    'overhead-press': 'Overhead Press (Barbell)',
    'dumbbell-shoulder-press': 'Shoulder Press (Dumbbell)',
    'lateral-raise': 'Lateral Raise (Dumbbell)',
    'front-raise': 'Front Raise (Dumbbell)',
    'rear-delt-fly': 'Rear Delt Fly (Dumbbell)',
    'face-pull': 'Face Pull (Cable)',
    'shrug': 'Shrug (Dumbbell)',
    'barbell-curl': 'Bicep Curl (Barbell)',
    'dumbbell-curl': 'Bicep Curl (Dumbbell)',
    'hammer-curl': 'Hammer Curl (Dumbbell)',
    'preacher-curl': 'Preacher Curl (Barbell)',
    'triceps-pushdown': 'Triceps Pushdown (Cable)',
    'skull-crusher': 'Skull Crusher (Barbell)',
    'overhead-triceps-extension': 'Overhead Triceps Extension (Dumbbell)',
    'back-squat': 'Squat (Barbell)',
    'front-squat': 'Front Squat (Barbell)',
    'goblet-squat': 'Goblet Squat',
    'leg-press': 'Leg Press',
    'dumbbell-lunge': 'Lunge (Dumbbell)',
    'bulgarian-split-squat': 'Bulgarian Split Squat',
    'romanian-deadlift': 'Romanian Deadlift (Barbell)',
    'leg-extension': 'Leg Extension (Machine)',
    'leg-curl': 'Leg Curl (Machine)',
    'hip-thrust': 'Hip Thrust (Barbell)',
    'glute-bridge': 'Glute Bridge',
    'hip-abduction': 'Hip Abduction (Machine)',
    'cable-kickback': 'Glute Kickback (Cable)',
    'step-up': 'Step-Up (Dumbbell)',
    'sumo-deadlift': 'Sumo Deadlift (Barbell)',
    'calf-raise': 'Calf Raise (Machine)',
    'kettlebell-swing': 'Kettlebell Swing',
    'plank': 'Plank',
    'crunch': 'Crunch',
    'hanging-leg-raise': 'Hanging Leg Raise',
    'ab-wheel': 'Ab Wheel Rollout',
    'treadmill-run': 'Running (Treadmill)',
    'incline-walk': 'Incline Walk (Treadmill)',
    'stationary-bike': 'Stationary Bike',
    'rowing-machine': 'Rowing Machine',
    'jump-rope': 'Jump Rope',
}
