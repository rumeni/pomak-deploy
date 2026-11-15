import { describe, expect, it } from 'vitest'

import type { Food } from './api'
import { nutritionFor } from './nutrition'

const egg: Food = {
  id: 'e', name: 'Jaje', aliases: '', source: 'usda', source_ref: '171287', state: 'raw',
  kcal: '143.0', protein_g: '12.56', carbs_g: '0.72', fat_g: '9.51', fiber_g: '0.00', portions: [], is_custom: false,
}

describe('nutritionFor', () => {
  it('preračunava sa 100 g na zadatu količinu', () => {
    expect(nutritionFor(egg, 50)).toEqual({ kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8, fiber: 0 })
    expect(nutritionFor(egg, 100)).toEqual({ kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, fiber: 0 })
  })

  it('nepoznata vrednost ostaje nepoznata, ne postaje 0', () => {
    const ajvar: Food = { ...egg, kcal: '95', protein_g: null, carbs_g: null, fat_g: '7.5', fiber_g: null }
    expect(nutritionFor(ajvar, 20)).toEqual({ kcal: 19, protein: null, carbs: null, fat: 1.5, fiber: null })
  })
})
