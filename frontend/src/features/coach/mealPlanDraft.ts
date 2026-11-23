import type { MealKey } from '../diary/types'
import type { Food } from '../nutrition/api'
import type { ClientMealPlan, MealPlanItemInput } from './mealPlanApi'

/** An item being edited: what is sent, plus the food's name to show. */
export interface DraftItem extends MealPlanItemInput { name: string }

export function fromServer(plan: ClientMealPlan): DraftItem[] {
  return plan.items.map((item) => ({
    meal: item.meal, food_id: item.food!.id, name: item.food!.name, grams: String(Number(item.grams)), portion_name: item.portion_name,
  }))
}

/** A new item: the food's first usual portion, else 100 g. */
export function newPlanItem(meal: MealKey, food: Food): DraftItem {
  const portion = food.portions[0]
  return { meal, food_id: food.id, name: food.name, grams: portion ? String(Number(portion.grams)) : '100', portion_name: portion?.name ?? '' }
}
