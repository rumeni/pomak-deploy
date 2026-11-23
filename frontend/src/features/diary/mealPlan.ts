import type { MealPlanItem } from '../coach/mealPlanApi'
import type { Food } from '../nutrition/api'
import { entryFromSavedItem, type EntryDraft } from './model'
import type { MealKey } from './types'

export function planItemsFor(items: MealPlanItem[] | undefined, meal: MealKey): MealPlanItem[] {
  return (items ?? []).filter((item) => item.meal === meal)
}

/** Diary entries for one meal of the coach's plan. Like a saved meal: the food's values today are snapshotted. */
export function planDrafts(items: MealPlanItem[], date: string, meal: MealKey, now: Date, id: () => string): EntryDraft[] {
  return items.flatMap((item) => entryFromSavedItem(item, id(), date, meal, now) ?? [])
}

/** "Ovsene pahuljice 60 g · Mleko 200 g" */
export function planSummary(items: MealPlanItem[], formatGrams: (grams: number) => string): string {
  return items.map((item) => `${(item.food as Food).name} ${item.portion_name || `${formatGrams(Number(item.grams))} g`}`).join(' · ')
}
