import { describe, expect, it } from 'vitest'

import { kcalCheck } from './labelCheck'

describe('calories vs macros', () => {
  it('accepts label rounding and flags clear mismatches', () => {
    // 3,2 g P, 4,6 g UH, 2,8 g M -> 56,4 kcal; the label says 61.
    expect(kcalCheck({ kcal: '61', protein_g: '3,2', carbs_g: '4,6', fat_g: '2,8' })).toEqual({ ok: true, expected: 56 })
    expect(kcalCheck({ kcal: '250', protein_g: '3,2', carbs_g: '4,6', fat_g: '2,8' })?.ok).toBe(false)
    expect(kcalCheck({ kcal: '61', protein_g: '', carbs_g: '4,6', fat_g: '2,8' })).toBeNull()
  })
})
