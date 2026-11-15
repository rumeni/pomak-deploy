"""Metod `msj-v1`: početna procena dnevnog kalorijskog cilja.

PREDLOG KOJI ČEKA STRUČNU PROVERU (docs/KALORIJSKI_METOD.md). Sve konstante su ovde, na jednom
mestu, sa izvorom; menja se samo uz novu verziju metoda (npr. `msj-v2`), jer se uz svaki cilj
čuva verzija kojom je izračunat (AC-06, AC-07).

Tok: podaci iz profila → bazalna potrošnja (BMR) → × faktor aktivnosti (potrošnja) →
± promena za izabrani tempo → zaokružen cilj → makroi. Kalorije sa treninga se NE dodaju
posebno: faktor aktivnosti već uključuje planirane treninge.
"""

import datetime
from dataclasses import dataclass

METHOD = 'msj-v1'

# Mifflin MD, St Jeor ST i sar. (1990), Am J Clin Nutr 51(2):241-7.
# BMR = 10·kg + 6,25·cm − 5·godine + s;  s = +5 (muškarci), −161 (žene)
MSJ_SEX_CONSTANT = {'male': 5, 'female': -161}

# Faktori aktivnosti (PAL) uobičajeni uz BMR formule (McArdle, Katch & Katch, Exercise Physiology).
ACTIVITY_FACTORS = {
    'sedentary': 1.2,
    'light': 1.375,
    'moderate': 1.55,
    'active': 1.725,
    'very_active': 1.9,
}

# Dozvoljen tempo: % telesne mase nedeljno.
PACES = {
    'lose': (0.25, 0.5, 0.75, 1.0),
    'maintain': (0.0,),
    'gain': (0.1, 0.25, 0.5),
}
# Približna energija 1 kg promene telesne mase (Wishnofsky 1958; poznato pojednostavljenje).
KCAL_PER_KG = 7700

# Ispod ovoga nema automatske preporuke (NIH/NHLBI smernice za niskokalorijske dijete bez nadzora).
KCAL_FLOOR = {'male': 1500, 'female': 1200}

# Proteini: ISSN stav (Jäger i sar. 2017) 1,4–2,0 g/kg; uzima se 1,6 g/kg.
PROTEIN_G_PER_KG = 1.6
# Masti: 25 % energije (u opsegu AMDR 20–35 %, Institute of Medicine 2005). UH: ostatak.
FAT_SHARE = 0.25

MIN_AGE = 18
MAX_AGE = 80  # Mifflin-St Jeor je razvijen na odraslima 19–78 god.


@dataclass
class Inputs:
    sex: str
    birth_date: datetime.date
    height_cm: float
    weight_kg: float
    weight_date: datetime.date
    activity: str
    goal: str
    pace: float
    valid_from: datetime.date

    @property
    def age(self) -> int:
        d, b = self.valid_from, self.birth_date
        return d.year - b.year - ((d.month, d.day) < (b.month, b.day))


def round_half_up(value: float, step: int = 1) -> int:
    return int((value / step) + 0.5) * step


def estimate(i: Inputs) -> dict:
    """Cilj i objašnjenje svakog koraka, ili razlog zašto nema automatske preporuke."""
    if not MIN_AGE <= i.age <= MAX_AGE:
        return {'supported': False, 'reason': 'age'}
    bmr = 10 * i.weight_kg + 6.25 * i.height_cm - 5 * i.age + MSJ_SEX_CONSTANT[i.sex]
    factor = ACTIVITY_FACTORS[i.activity]
    tdee = bmr * factor
    weekly_kg = i.weight_kg * i.pace / 100
    sign = {'lose': -1, 'maintain': 0, 'gain': 1}[i.goal]
    daily_adjustment = sign * weekly_kg * KCAL_PER_KG / 7
    kcal = round_half_up(tdee + daily_adjustment, 10)

    floor = KCAL_FLOOR[i.sex]
    if kcal < floor:
        return {'supported': False, 'reason': 'below_floor', 'floor': floor}

    protein = round_half_up(PROTEIN_G_PER_KG * i.weight_kg)
    fat = round_half_up(kcal * FAT_SHARE / 9)
    carbs = round_half_up((kcal - protein * 4 - fat * 9) / 4)
    if carbs < 0:
        return {'supported': False, 'reason': 'macros'}

    return {
        'supported': True,
        'kcal': kcal,
        'protein_g': protein,
        'carbs_g': carbs,
        'fat_g': fat,
        'method': METHOD,
        'inputs': {
            'sex': i.sex,
            'age': i.age,
            'height_cm': i.height_cm,
            'weight_kg': i.weight_kg,
            'weight_date': i.weight_date.isoformat(),
            'activity': i.activity,
            'goal': i.goal,
            'pace': i.pace,
        },
        'explanation': {
            'bmr': round_half_up(bmr),
            'activity_factor': factor,
            'tdee': round_half_up(tdee),
            'daily_adjustment': round_half_up(daily_adjustment) if daily_adjustment >= 0 else -round_half_up(-daily_adjustment),
            'weekly_change_kg': round(sign * weekly_kg, 2),
            'floor': floor,
            'protein_g_per_kg': PROTEIN_G_PER_KG,
            'fat_share': FAT_SHARE,
        },
    }
