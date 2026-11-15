import type { DiaryEntry, MealKey, MealSetting } from './types'
import { MEALS } from './types'

const DEFAULT_ENABLED: MealKey[] = ['breakfast', 'lunch', 'dinner', 'snack']

/** Podešavanja svih 6 mesta za obroke; nesačuvana podešavanja = podrazumevana 4 obroka. */
export function mealSettings(saved: { key: string; name: string; enabled: boolean }[] | null | undefined): MealSetting[] {
  const byKey = new Map((saved ?? []).map((m) => [m.key, m]))
  const ordered = saved ? saved.map((m) => m.key as MealKey).filter((k) => MEALS.includes(k)) : []
  const all = [...ordered, ...MEALS.filter((k) => !ordered.includes(k))]
  return all.map((key) => {
    const s = byKey.get(key)
    return { key, name: s?.name ?? '', enabled: s ? s.enabled : DEFAULT_ENABLED.includes(key) }
  })
}

/** Obroci za prikaz dana: uključeni + isključeni koji tog dana ipak imaju unos (ništa se ne sakriva). */
export function visibleMeals(settings: MealSetting[], entries: DiaryEntry[]): MealSetting[] {
  const used = new Set(entries.map((e) => e.meal))
  return settings.filter((m) => m.enabled || used.has(m.key))
}

/** Obroci koje korisnik može da izabere pri unosu (+ trenutni obrok stavke, ako je isključen). */
export function selectableMeals(settings: MealSetting[], current?: MealKey): MealSetting[] {
  return settings.filter((m) => m.enabled || m.key === current)
}

/** Obrok prema dobu dana (doručak do 11, ručak do 16, večera do 21, inače užina), među uključenima. */
export function mealForTime(settings: MealSetting[], now: Date): MealKey {
  const h = now.getHours()
  const guess: MealKey = h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack'
  const enabled = settings.filter((m) => m.enabled)
  return enabled.some((m) => m.key === guess) ? guess : (enabled[0]?.key ?? guess)
}

export function mealLabel(meal: MealKey, settings: MealSetting[], t: (key: string) => string): string {
  return settings.find((m) => m.key === meal)?.name || t(`diary.meal_${meal}`)
}
