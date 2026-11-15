import type { Food } from './api'

type Values = Pick<Food, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'>
const FIELDS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'] as const

export interface RecipePreview {
  /** Na 100 g gotovog jela; `null` = nepoznato kod bar jednog sastojka. */
  per100: Record<(typeof FIELDS)[number], number | null>
  /** Masa gotovog jela: upisana, ili zbir sastojaka. */
  mass: number
  rawMass: number
  servingGrams: number
}

/** Pregled vrednosti recepta dok se pravi (konačne vrednosti računa server, istom formulom). */
export function previewRecipe(ingredients: { food: Values; grams: number }[], mass: number | null, servings: number): RecipePreview | null {
  const rawMass = ingredients.reduce((sum, i) => sum + i.grams, 0)
  const total = mass ?? rawMass
  if (!ingredients.length || total <= 0) return null
  const per100 = Object.fromEntries(
    FIELDS.map((field) => {
      if (ingredients.some((i) => i.food[field] === null)) return [field, null]
      const sum = ingredients.reduce((s, i) => s + (Number(i.food[field]) * i.grams) / 100, 0)
      return [field, (sum * 100) / total]
    }),
  ) as RecipePreview['per100']
  return { per100, mass: total, rawMass, servingGrams: total / Math.max(1, servings) }
}
