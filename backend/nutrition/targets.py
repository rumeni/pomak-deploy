"""Metod `msj-v2`: početna procena dnevnog kalorijskog cilja i makroa, po cilju.

PREDLOG KOJI ČEKA STRUČNU PROVERU (docs/KALORIJSKI_METOD.md). Sve konstante su ovde, na jednom
mestu, sa izvorom; menja se samo uz novu verziju metoda, jer se uz svaki cilj čuva verzija
kojom je izračunat (AC-06, AC-07). Ciljevi izračunati ranijom verzijom (`msj-v1`) ostaju kakvi
su bili.

Tok: podaci iz profila → bazalna potrošnja (BMR) → × faktor aktivnosti (potrošnja) →
± promena za izabrani tempo (samo gubitak i dobijanje) → zaokružen cilj → makroi po cilju.
Kalorije sa treninga se NE dodaju posebno: faktor aktivnosti već uključuje planirane treninge.

Vrednosti su početne preporuke za zdrave odrasle osobe koje treniraju, ne univerzalno optimalne
vrednosti; korisnik uvek može da postavi svoj cilj, a trener cilj svog klijenta.
"""

import datetime
import math
from dataclasses import dataclass

METHOD = 'msj-v2'
# Older apps send lose / maintain / gain and show what the server estimated for them: those
# requests keep the earlier method, so what such an app shows is exactly what it saves.
LEGACY_METHOD = 'msj-v1'
LEGACY_PROTEIN_G_PER_KG = 1.6

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

# Ciljevi: dozvoljen tempo (% telesne mase nedeljno), smer promene i proteini (g po kg).
#  - gubitak masnog tkiva: sporiji gubitak 0,5–1 %/ned. čuva mišićnu masu (Helms i sar. 2014,
#    JISSN 11:20); u deficitu više proteina (ISSN, Jäger i sar. 2017, JISSN 14:20) → 2,0 g/kg;
#  - povećanje mišićne mase: mali suficit ~0,25–0,5 %/ned. (Iraki i sar. 2019, Sports 7:154),
#    proteini 1,6–2,2 g/kg → 1,8 g/kg;
#  - rekompozicija: kalorije za održavanje, bez tempa promene težine, visoki proteini i trening
#    snage (Barakat i sar. 2020, Strength Cond J 42(5):7-21) → 2,0 g/kg;
#  - održavanje: korist od proteina raste do ~1,6 g/kg (Morton i sar. 2018, Br J Sports Med
#    52:376-384) → 1,6 g/kg.
GOALS = {
    'fat_loss': {'paces': (0.25, 0.5, 0.75, 1.0), 'sign': -1, 'protein_g_per_kg': 2.0},
    'muscle_gain': {'paces': (0.1, 0.25, 0.5), 'sign': 1, 'protein_g_per_kg': 1.8},
    'recomposition': {'paces': (0.0,), 'sign': 0, 'protein_g_per_kg': 2.0},
    'maintenance': {'paces': (0.0,), 'sign': 0, 'protein_g_per_kg': 1.6},
}
# Vrednosti ranijih verzija aplikacije (stari APK-ovi ih i dalje šalju).
LEGACY_GOALS = {'lose': 'fat_loss', 'gain': 'muscle_gain', 'maintain': 'maintenance'}
PACES = {goal: rule['paces'] for goal, rule in GOALS.items()}

# Približna energija 1 kg promene telesne mase (Wishnofsky 1958; poznato pojednostavljenje).
KCAL_PER_KG = 7700

# Ispod ovoga nema automatske preporuke (NIH/NHLBI smernice za niskokalorijske dijete bez nadzora).
KCAL_FLOOR = {'male': 1500, 'female': 1200}

# Proteini kod veće telesne mase: računaju se prema prilagođenoj težini (adjusted body weight),
# kako se radi u kliničkoj nutriciji (Krenitsky 2005, Nutr Clin Pract 20(4):468-73), da preporuka
# ne raste nerealno sa masnim tkivom. Do referentne težine (BMI 25 za tu visinu) uzima se stvarna
# težina; iznad nje referentna + 40 % razlike. Prelaz je neprekidan: nema skoka ni na jednoj težini.
# BMI nije pokazatelj sastava tela: ovo je samo gornja zaštita, ne procena masnog tkiva.
REFERENCE_BMI = 25
ADJUSTED_WEIGHT_FACTOR = 0.4

# Masti: 25 % energije (u opsegu AMDR 20–35 %, Institute of Medicine 2005). UH: ostatak.
FAT_SHARE = 0.25

MIN_AGE = 18
MAX_AGE = 80  # Mifflin-St Jeor je razvijen na odraslima 19–78 god.


def normalize_goal(goal: str) -> str:
    return LEGACY_GOALS.get(goal, goal)


def protein_weight(weight_kg: float, height_cm: float) -> float:
    """The weight protein is computed from: actual up to the reference, then adjusted."""
    reference = REFERENCE_BMI * (height_cm / 100) ** 2
    if weight_kg <= reference:
        return weight_kg
    return reference + ADJUSTED_WEIGHT_FACTOR * (weight_kg - reference)


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
    # int() truncates toward zero: -1 would incorrectly become 0.
    return math.floor((value / step) + 0.5) * step


def estimate(i: Inputs) -> dict:
    """Cilj i objašnjenje svakog koraka, ili razlog zašto nema automatske preporuke."""
    if not MIN_AGE <= i.age <= MAX_AGE:
        return {'supported': False, 'reason': 'age'}
    legacy = i.goal in LEGACY_GOALS
    goal = normalize_goal(i.goal)
    rule = GOALS[goal]
    bmr = 10 * i.weight_kg + 6.25 * i.height_cm - 5 * i.age + MSJ_SEX_CONSTANT[i.sex]
    factor = ACTIVITY_FACTORS[i.activity]
    tdee = bmr * factor
    weekly_kg = i.weight_kg * i.pace / 100 if rule['sign'] else 0.0
    daily_adjustment = rule['sign'] * weekly_kg * KCAL_PER_KG / 7
    kcal = round_half_up(tdee + daily_adjustment, 10)

    floor = KCAL_FLOOR[i.sex]
    if kcal < floor:
        return {'supported': False, 'reason': 'below_floor', 'floor': floor}

    # msj-v1 (older apps): 1.6 g per kg of actual weight for every goal.
    weight_for_protein = i.weight_kg if legacy else protein_weight(i.weight_kg, i.height_cm)
    protein_per_kg = LEGACY_PROTEIN_G_PER_KG if legacy else rule['protein_g_per_kg']
    protein = round_half_up(protein_per_kg * weight_for_protein)
    fat = round_half_up(kcal * FAT_SHARE / 9)
    raw_carbs = (kcal - protein * 4 - fat * 9) / 4
    # A rounded zero must not conceal a negative macro balance.
    if raw_carbs < 0:
        return {'supported': False, 'reason': 'macros'}
    carbs = round_half_up(raw_carbs)

    return {
        'supported': True,
        'kcal': kcal,
        'protein_g': protein,
        'carbs_g': carbs,
        'fat_g': fat,
        'method': LEGACY_METHOD if legacy else METHOD,
        'inputs': {
            'sex': i.sex,
            'age': i.age,
            'height_cm': i.height_cm,
            'weight_kg': i.weight_kg,
            'weight_date': i.weight_date.isoformat(),
            'activity': i.activity,
            'goal': i.goal if legacy else goal,
            'pace': i.pace if rule['sign'] else 0.0,
        },
        'explanation': {
            'bmr': round_half_up(bmr),
            'activity_factor': factor,
            'tdee': round_half_up(tdee),
            'daily_adjustment': round_half_up(daily_adjustment) if daily_adjustment >= 0 else -round_half_up(-daily_adjustment),
            'weekly_change_kg': round(rule['sign'] * weekly_kg, 2),
            'floor': floor,
            'protein_g_per_kg': protein_per_kg,
            # The weight the protein is based on, and whether it was adjusted (high body mass).
            'protein_weight_kg': round(weight_for_protein, 1),
            'protein_weight_adjusted': weight_for_protein < i.weight_kg,
            'fat_share': FAT_SHARE,
        },
    }
