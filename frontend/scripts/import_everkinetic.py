"""Uvoz crteža vežbi iz Everkinetic skupa (https://github.com/everkinetic/data, CC BY-SA 4.0).

Upotreba:
    git clone --depth 1 https://github.com/everkinetic/data everkinetic
    python scripts/import_everkinetic.py everkinetic

Kopira dva SVG crteža po vežbi (početni i završni položaj) u public/exercises/<slug>-1.svg i -2.svg
i pravi src/features/training/exerciseImages.ts. Crteži se ne menjaju (samo se kopiraju), pa ostaju
pod istom licencom; autorstvo je navedeno u aplikaciji (Profil → O aplikaciji) i u public/exercises/README.md.

Svako uparivanje je provereno vizuelno. Vežba bez odgovarajućeg crteža ostaje bez slike (bolje nego
pogrešna slika): kardio, plank, face pull, swing sa girjom, goblet čučanj, viseće podizanje nogu, pec deck.
"""

import json
import shutil
import sys
from pathlib import Path

# naš slug -> Everkinetic naziv
MAP = {
    'ab-wheel': 'ab-rollout-with-barbell',
    'assisted-pull-up': 'pull-ups',
    'back-extension': 'hyperextensions',
    'back-squat': 'barbell-squat',
    'barbell-curl': 'biceps-curls-with-barbell',
    'barbell-row': 'rear-deltoid-row-barbell',
    'bench-press': 'bench-press',
    'bulgarian-split-squat': 'one-leg-squat-with-barbell',
    'cable-crossover': 'cable-crossover',
    'calf-raise': 'standing-calf-raises-using-machine',
    'crunch': 'crunches',
    'deadlift': 'barbell-dead-lifts',
    'dips': 'tricep-dips-using-body-weight',
    'dumbbell-bench-press': 'bench-press-dumbbell',
    'dumbbell-curl': 'biceps-curl-with-dumbbell',
    'dumbbell-fly': 'dumbbell-flys',
    'dumbbell-lunge': 'dumbbell-lunges',
    'dumbbell-row': 'rear-deltoid-row-dumbbell',
    'dumbbell-shoulder-press': 'one-arm-dumbbell-shoulder-press',
    'front-raise': 'front-dumbbell-raise',
    'front-squat': 'front-squat-with-barbell',
    'hammer-curl': 'biceps-hammer-curl-with-dumbbell',
    'hip-thrust': 'bridging',
    'incline-bench-press': 'incline-bench-press',
    'incline-dumbbell-press': 'incline-dumbbell-press',
    'lat-pulldown': 'underhand-pull-down',
    'lateral-raise': 'lateral-dumbbell-raises',
    'leg-curl': 'lying-leg-curl-machine',
    'leg-extension': 'leg-extensions',
    'leg-press': 'leg-press',
    'overhead-press': 'seated-military-press',
    'overhead-triceps-extension': 'seated-triceps-press-with-dumbbell',
    'preacher-curl': 'preacher-curl-with-barbell',
    'pull-up': 'pull-ups',
    'push-up': 'push-ups',
    'rear-delt-fly': 'bent-over-rear-deltoid-raise-with-head-on-bench',
    'romanian-deadlift': 'romanian-dead-lift',
    'seated-cable-row': 'seated-cable-rows',
    'shrug': 'shoulder-shrugs',
    'skull-crusher': 'lying-triceps-press-with-barbell',
    'triceps-pushdown': 'triceps-pushdown-with-cable',
    'weighted-pull-up': 'pull-ups',
}

ROOT = Path(__file__).resolve().parent.parent


def main(source: Path) -> None:
    exercises = {x['name']: x for x in json.loads((source / 'exercises.json').read_text(encoding='utf-8'))}
    out = ROOT / 'public' / 'exercises'
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for slug, name in sorted(MAP.items()):
        num = exercises[name]['id_num']
        for i, frame in enumerate(('relaxation', 'tension'), start=1):
            shutil.copyfile(source / 'dist' / 'svg' / f'{num}-{frame}.svg', out / f'{slug}-{i}.svg')
        rows.append(f'| {slug} | {name} | {exercises[name]["url"]} |')

    (out / 'README.md').write_text(
        '# Crteži vežbi\n\n'
        'Izvor: Everkinetic (everkinetic.com, Greg Priday), https://github.com/everkinetic/data\n'
        'Licenca: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0), '
        'https://creativecommons.org/licenses/by-sa/4.0/\n'
        'Crteži su kopirani bez izmena (`<slug>-1.svg` početni, `<slug>-2.svg` završni položaj).\n\n'
        '| POMAK vežba | Everkinetic | Izvor |\n|---|---|---|\n' + '\n'.join(rows) + '\n',
        encoding='utf-8',
    )
    slugs = ',\n'.join(f"  '{s}'" for s in sorted(MAP))
    (ROOT / 'src' / 'features' / 'training' / 'exerciseImages.ts').write_text(
        '// Generisano: scripts/import_everkinetic.py. Ne menjati ručno.\n'
        '// Crteži: Everkinetic (everkinetic.com), CC BY-SA 4.0.\n'
        f'export const EXERCISE_IMAGE_SLUGS: ReadonlySet<string> = new Set([\n{slugs},\n])\n',
        encoding='utf-8',
    )
    print(f'{len(MAP)} vežbi, {2 * len(MAP)} crteža')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
