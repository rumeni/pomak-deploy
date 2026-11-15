export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal5' | 'meal6'
/** Sva mesta za obroke; koja se koriste i kako se zovu bira korisnik (vidi meals.ts). */
export const MEALS: MealKey[] = ['breakfast', 'lunch', 'dinner', 'snack', 'meal5', 'meal6']

export interface MealSetting {
  key: MealKey
  /** Prazno = podrazumevani naziv na jeziku aplikacije. */
  name: string
  enabled: boolean
}

export type DayStatus = 'in_progress' | 'complete' | 'incomplete'

/** Stavka dnevnika sa servera: ukupne vrednosti + snimak na 100 g (null = nepoznato). */
export interface DiaryEntry {
  id: string
  date: string
  meal: MealKey
  food_id: string | null
  name: string
  grams: string | null
  portion_name: string
  per100_kcal: string | null
  per100_protein_g: string | null
  per100_carbs_g: string | null
  per100_fat_g: string | null
  per100_fiber_g: string | null
  kcal: string
  protein_g: string | null
  carbs_g: string | null
  fat_g: string | null
  fiber_g: string | null
  created_at: string
}

export interface DiaryDay {
  date: string
  /** null = korisnik nije označio status (i dan bez unosa ima null). */
  status: DayStatus | null
  entries: DiaryEntry[]
  /** Cilj koji važi tog dana (null = nema cilja; nema polja u danima sačuvanim pre verzije 1.5). */
  target?: DayTarget | null
}

export interface DayTarget {
  valid_from: string
  mode: 'app' | 'manual' | 'coach'
  kcal: number
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

/** Telo PUT /nutrition/entries/<id>/ */
export interface EntryWrite {
  date: string
  meal: MealKey
  food_id: string | null
  grams: string | null
  portion_name: string
  name: string
  kcal: string | null
  protein_g: string | null
  carbs_g: string | null
  fat_g: string | null
  fiber_g: string | null
}
