import { describe, expect, it } from 'vitest'

import type { Target } from './api'
import { targetOn } from './target'

const target = (valid_from: string, kcal: number): Target => ({
  valid_from, kcal, mode: 'manual', protein_g: null, carbs_g: null, fat_g: null, method: '', inputs: null, explanation: null, created_at: '',
})

describe('targetOn', () => {
  // Server vraća ciljeve od najnovijeg
  const list = [target('2026-10-10', 1900), target('2026-09-30', 2100)]

  it('za dan važi poslednji cilj koji je počeo tog dana ili ranije', () => {
    expect(targetOn(list, '2026-09-30')?.kcal).toBe(2100)
    expect(targetOn(list, '2026-10-09')?.kcal).toBe(2100)
    expect(targetOn(list, '2026-10-10')?.kcal).toBe(1900)
  })

  it('pre prvog cilja nema cilja', () => {
    expect(targetOn(list, '2026-09-29')).toBeUndefined()
  })
})
