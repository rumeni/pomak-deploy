import { describe, expect, it } from 'vitest'

import { previewRecipe } from './recipe'

const rice = { kcal: '365.0', protein_g: '7.13', carbs_g: '79.95', fat_g: '0.66', fiber_g: '1.30' }
const oil = { kcal: '884.0', protein_g: '0.00', carbs_g: '0.00', fat_g: '100.00', fiber_g: '0.00' }

describe('previewRecipe', () => {
  it('računa na 100 g gotovog jela i porciju (isto kao server)', () => {
    const p = previewRecipe([{ food: rice, grams: 200 }, { food: oil, grams: 10 }], 600, 3)!
    expect(p.per100.kcal).toBeCloseTo(136.4, 1)
    expect(p.per100.fat_g).toBeCloseTo(1.89, 2)
    expect(p.servingGrams).toBe(200)
    expect(p.rawMass).toBe(210)
  })

  it('bez mase gotovog jela koristi zbir sastojaka', () => {
    expect(previewRecipe([{ food: rice, grams: 200 }, { food: oil, grams: 10 }], null, 1)!.per100.kcal).toBeCloseTo(389.7, 1)
  })

  it('nepoznata vrednost sastojka je nepoznata i u receptu (ne 0)', () => {
    const p = previewRecipe([{ food: rice, grams: 100 }, { food: { ...oil, protein_g: null }, grams: 10 }], null, 1)!
    expect(p.per100.protein_g).toBeNull()
    expect(p.per100.fat_g).not.toBeNull()
  })

  it('prazan recept nema pregled', () => {
    expect(previewRecipe([], null, 1)).toBeNull()
  })
})

describe('recipe ingredient-only edit detection', () => {
  const old = [
    { food_id: 'archived-food', grams: '100.0', portion_name: '1 porcija' },
    { food_id: 'active-food', grams: '45.0', portion_name: '' },
  ]

  it('omits unchanged archived ingredients on a metadata-only PATCH', async () => {
    const { recipeIngredientsUnchanged } = await import('./recipe')
    expect(recipeIngredientsUnchanged(
      [{ ...old[0], grams: '100' }, { ...old[1], grams: '45' }], old,
    )).toBe(true)
  })

  it('sends ingredients when portions, amounts, identity, or order changed', async () => {
    const { recipeIngredientsUnchanged } = await import('./recipe')
    expect(recipeIngredientsUnchanged([{ ...old[0], grams: '110' }, old[1]], old)).toBe(false)
    expect(recipeIngredientsUnchanged([{ ...old[0], portion_name: '' }, old[1]], old)).toBe(false)
    expect(recipeIngredientsUnchanged([old[1], old[0]], old)).toBe(false)
    expect(recipeIngredientsUnchanged([old[0]], old)).toBe(false)
    expect(recipeIngredientsUnchanged([...old, { food_id: 'new', grams: '20', portion_name: '' }], old)).toBe(false)
  })
})
