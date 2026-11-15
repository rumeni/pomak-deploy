import { describe, expect, it } from 'vitest'

import { mealForTime, mealLabel, mealSettings, selectableMeals, visibleMeals } from './meals'
import type { DiaryEntry } from './types'

const t = (k: string) => `[${k}]`

describe('obroci', () => {
  it('bez podešavanja: podrazumevana 4 obroka, 5. i 6. isključeni', () => {
    const s = mealSettings(null)
    expect(s.filter((m) => m.enabled).map((m) => m.key)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    expect(s).toHaveLength(6)
  })

  it('sačuvan redosled i nazivi; ostala mesta dolaze posle', () => {
    const s = mealSettings([
      { key: 'meal5', name: 'Pre spavanja', enabled: true },
      { key: 'breakfast', name: '', enabled: true },
    ])
    expect(s.map((m) => m.key)).toEqual(['meal5', 'breakfast', 'lunch', 'dinner', 'snack', 'meal6'])
    expect(mealLabel('meal5', s, t)).toBe('Pre spavanja')
    expect(mealLabel('breakfast', s, t)).toBe('[diary.meal_breakfast]')
  })

  it('isključen obrok sa unosom se i dalje vidi; pri izboru se nudi samo ako je trenutni', () => {
    const s = mealSettings([{ key: 'snack', name: '', enabled: false }])
    const entries = [{ meal: 'snack' } as DiaryEntry]
    expect(visibleMeals(s, entries).map((m) => m.key)).toContain('snack')
    expect(visibleMeals(s, []).map((m) => m.key)).not.toContain('snack')
    expect(selectableMeals(s).map((m) => m.key)).not.toContain('snack')
    expect(selectableMeals(s, 'snack').map((m) => m.key)).toContain('snack')
  })
})

describe('mealForTime', () => {
  const at = (h: number) => new Date(2026, 8, 30, h, 0)
  it('obrok prema dobu dana', () => {
    const s = mealSettings(null)
    expect([8, 13, 19, 23].map((h) => mealForTime(s, at(h)))).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
  })
  it('isključen obrok se ne predlaže', () => {
    const s = mealSettings([{ key: 'breakfast', name: '', enabled: false }])
    expect(mealForTime(s, at(8))).toBe('lunch')
  })
})
