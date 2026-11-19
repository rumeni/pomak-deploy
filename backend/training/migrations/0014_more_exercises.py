from django.db import migrations

from core.text import normalize_search
from training.data.instructions import INSTRUCTIONS
from training.exercise_library import EXERCISES, NAMES_EN

NEW = {
    'decline-bench-press',
    'smith-bench-press',
    'chest-press-machine',
    'incline-dumbbell-fly',
    'low-cable-fly',
    'incline-push-up',
    'decline-push-up',
    'knee-push-up',
    'dumbbell-pullover',
    'close-grip-bench-press',
    'weighted-dips',
    'assisted-dips',
    'bench-dips',
    'rope-pushdown',
    'overhead-cable-extension',
    'dumbbell-kickback',
    'diamond-push-up',
    'dumbbell-skull-crusher',
    'triceps-dip-machine',
    'chin-up',
    'close-grip-pulldown',
    'straight-arm-pulldown',
    't-bar-row',
    'chest-supported-row',
    'machine-row',
    'inverted-row',
    'rack-pull',
    'trap-bar-deadlift',
    'single-arm-cable-row',
    'superman',
    'good-morning',
    'arnold-press',
    'machine-shoulder-press',
    'landmine-press',
    'cable-lateral-raise',
    'machine-lateral-raise',
    'upright-row',
    'reverse-pec-deck',
    'push-press',
    'pike-push-up',
    'plate-front-raise',
    'barbell-shrug',
    'band-pull-apart',
    'cable-curl',
    'ez-bar-curl',
    'incline-dumbbell-curl',
    'concentration-curl',
    'machine-curl',
    'reverse-curl',
    'cable-hammer-curl',
    'dumbbell-preacher-curl',
    'hack-squat',
    'smith-squat',
    'bodyweight-squat',
    'walking-lunge',
    'reverse-lunge',
    'split-squat',
    'lateral-lunge',
    'dumbbell-romanian-deadlift',
    'seated-leg-curl',
    'nordic-curl',
    'seated-calf-raise',
    'wall-sit',
    'box-jump',
    'jump-squat',
    'hip-adduction',
    'leg-press-calf-raise',
    'single-leg-glute-bridge',
    'hip-thrust-machine',
    'cable-pull-through',
    'donkey-kick',
    'fire-hydrant',
    'band-lateral-walk',
    'kettlebell-sumo-squat',
    'side-plank',
    'russian-twist',
    'cable-crunch',
    'lying-leg-raise',
    'bicycle-crunch',
    'dead-bug',
    'mountain-climber',
    'pallof-press',
    'hanging-knee-raise',
    'reverse-crunch',
    'sit-up',
    'hollow-hold',
    'elliptical',
    'stair-climber',
    'outdoor-run',
    'walking',
    'cycling',
    'swimming',
    'jumping-jacks',
    'battle-ropes',
    'burpee',
    'thruster',
    'power-clean',
    'turkish-get-up',
}


def seed(apps, schema_editor):
    """A larger shared library: more variations per muscle group, machines, bodyweight and cardio."""
    Exercise = apps.get_model('training', 'Exercise')
    for slug, name, aliases, equipment, measurement, muscle, load_mode in EXERCISES:
        if slug not in NEW:
            continue
        name_en = NAMES_EN.get(slug, '')
        text = INSTRUCTIONS.get(slug, {'sr': [], 'en': []})
        Exercise.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name, 'name_en': name_en, 'aliases': aliases,
                'search_name': normalize_search(f'{name} {name_en} {aliases}'),
                'equipment': equipment, 'measurement': measurement, 'muscle': muscle, 'load_mode': load_mode,
                'instructions': '\n'.join(text['sr']), 'instructions_en': '\n'.join(text['en']),
            },
        )



class Migration(migrations.Migration):
    dependencies = [('training', '0013_routine_program_key')]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
