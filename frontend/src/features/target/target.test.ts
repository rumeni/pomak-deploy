import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))

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

describe('nutrition goals', () => {
  it('earlier targets show under the new goals', async () => {
    const { normalizeGoal, hasPace, PACES, GOALS } = await import('./api')
    expect(normalizeGoal('lose')).toBe('fat_loss')
    expect(normalizeGoal('maintain')).toBe('maintenance')
    expect(normalizeGoal('gain')).toBe('muscle_gain')
    expect(normalizeGoal('recomposition')).toBe('recomposition')
    expect(GOALS).toEqual(['fat_loss', 'muscle_gain', 'recomposition', 'maintenance'])
    // Same paces as the server; recomposition and maintenance have none.
    expect(PACES.fat_loss).toEqual([0.25, 0.5, 0.75, 1])
    expect(PACES.muscle_gain).toEqual([0.1, 0.25, 0.5])
    expect([hasPace('recomposition'), hasPace('maintenance'), hasPace('fat_loss')]).toEqual([false, false, true])
  })
})
