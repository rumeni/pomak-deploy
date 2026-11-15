import type { Food } from './api'

/** Vrednosti za zadatu količinu. `null` = nepoznato u izvoru (ne sabira se kao 0). */
export interface Nutrition {
  kcal: number
  protein: number | null
  carbs: number | null
  fat: number | null
  fiber: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

function scale(per100: string | null, grams: number): number | null {
  return per100 === null ? null : round1((Number(per100) * grams) / 100)
}

/** Preračunava vrednosti sa 100 g na zadatu količinu u gramima. */
export function nutritionFor(food: Food, grams: number): Nutrition {
  return {
    kcal: Math.round((Number(food.kcal) * grams) / 100),
    protein: scale(food.protein_g, grams),
    carbs: scale(food.carbs_g, grams),
    fat: scale(food.fat_g, grams),
    fiber: scale(food.fiber_g, grams),
  }
}
