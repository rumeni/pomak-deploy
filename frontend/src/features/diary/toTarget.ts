import { formatDecimal } from '../../lib/format'
import type { Food } from '../nutrition/api'
import type { DayTotals } from './model'
import type { DayTarget } from './types'

export type MacroKey = 'protein' | 'carbs' | 'fat'
const GOAL: Record<MacroKey, 'protein_g' | 'carbs_g' | 'fat_g'> = { protein: 'protein_g', carbs: 'carbs_g', fat: 'fat_g' }
const MACROS: MacroKey[] = ['protein', 'carbs', 'fat']

/** What is left to the day's target. A macro without a goal is null. Only known values are counted,
 * so with unknown entries the real remainder may be smaller (the diary already says so). */
export interface Remaining {
  kcal: number
  protein: number | null
  carbs: number | null
  fat: number | null
}

export function remainingToTarget(tot: DayTotals, target: DayTarget): Remaining {
  const left = (macro: MacroKey) => {
    const goal = target[GOAL[macro]]
    return goal === null ? null : round1(goal - tot[macro].value)
  }
  return { kcal: round1(target.kcal - tot.kcal), protein: left('protein'), carbs: left('carbs'), fat: left('fat') }
}

/** Protein while at least a quarter of its goal is missing (what people training chase, and carbs or
 * fat fill up anyway); otherwise the macro furthest from its goal, by share. Null when none is behind. */
export function focusMacro(rem: Remaining, target: DayTarget): MacroKey | null {
  const shareLeft = (macro: MacroKey) => {
    const goal = target[GOAL[macro]]
    const left = rem[macro]
    return goal === null || goal <= 0 || left === null ? null : left / goal
  }
  const protein = shareLeft('protein')
  if (protein !== null && protein >= 0.25) return 'protein'
  let best: MacroKey | null = null
  let bestShare = 0.1 // less than 10 % behind is close enough
  for (const macro of MACROS) {
    const share = shareLeft(macro)
    if (share !== null && share > bestShare) {
      best = macro
      bestShare = share
    }
  }
  return best
}

export interface Suggestion {
  food: Food
  grams: number
  portionName: string
  kcal: number
  /** Grams of the focus macro in this amount (null when there is no focus macro). */
  macroGrams: number | null
}

/**
 * Up to `limit` amounts of foods the user already eats that fit in the calories left, best source
 * of the focus macro first. Foods whose focus value is unknown are skipped, never treated as 0.
 * No ready-made menus: suggestions only come from the user's own recent foods.
 */
export function suggestFoods(foods: Food[], rem: Remaining, focus: MacroKey | null, limit = 3): Suggestion[] {
  if (rem.kcal <= 0) return []
  const field = focus ? (`${focus}_g` as const) : null
  const seen = new Set<string>()
  const options: (Suggestion & { score: number; order: number })[] = []
  foods.forEach((food, order) => {
    if (seen.has(food.id)) return
    seen.add(food.id)
    const per100 = Number(food.kcal)
    const macroPer100 = field ? food[field] : null
    if (!Number.isFinite(per100) || per100 <= 0 || (field && macroPer100 === null)) return
    const portion = food.portions[0]
    const grams = portion ? Number(portion.grams) : 100
    if (!(grams > 0)) return
    const kcal = Math.round((per100 * grams) / 100)
    if (kcal > rem.kcal) return
    const macroGrams = field ? round1((Number(macroPer100) * grams) / 100) : null
    if (field && !(macroGrams! > 0)) return
    // Macro per kcal: the most of what is missing for the fewest calories.
    const score = field ? Number(macroPer100) / per100 : 0
    options.push({ food, grams, portionName: portion?.name ?? '', kcal, macroGrams, score, order })
  })
  options.sort((a, b) => b.score - a.score || a.order - b.order)
  return options.slice(0, limit).map(({ score: _score, order: _order, ...s }) => s)
}

/** "1 jaje (50 g) · +6,3 g proteina · 72 kcal" */
export function suggestionText(idea: Suggestion, focus: MacroKey | null, t: (key: string, options?: Record<string, unknown>) => string) {
  const amount = idea.portionName ? `${idea.portionName} (${formatDecimal(idea.grams)} g)` : `${formatDecimal(idea.grams)} g`
  const macro = focus && idea.macroGrams !== null ? ` · ${t(`diary.suggestionMacro_${focus}`, { grams: formatDecimal(idea.macroGrams) })}` : ''
  return `${amount}${macro} · ${idea.kcal} kcal`
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}
