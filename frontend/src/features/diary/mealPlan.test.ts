import { describe, expect, it } from 'vitest'

import type { MealPlanItem } from '../coach/mealPlanApi'
import { fromServer, newPlanItem } from '../coach/mealPlanDraft'
import type { Food } from '../nutrition/api'
import { planDrafts, planItemsFor, planSummary } from './mealPlan'

const food = (id: string, name: string, kcal: string, protein: string | null, portions: Food['portions'] = []): Food => ({
  id, name, aliases: '', source: 'usda', source_ref: '', state: 'na', kcal, protein_g: protein, carbs_g: '10', fat_g: '5',
  fiber_g: null, portions, is_custom: false,
})
const oats = food('oats', 'Ovsene pahuljice', '379', '13.2', [{ name: '1 šolja', grams: '81.00' }])
const milk = food('milk', 'Mleko 2%', '50', '3.3')
const item = (meal: MealPlanItem['meal'], f: Food, grams: string, portion = ''): MealPlanItem => ({
  meal, food: f, grams, portion_name: portion, name: '', kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null,
})
const plan = [item('breakfast', oats, '60.0'), item('breakfast', milk, '200.0'), item('lunch', milk, '100.0', '1 čaša')]

describe('logging the coach\'s meal plan', () => {
  it('takes only the items of that meal', () => {
    expect(planItemsFor(plan, 'breakfast').map((i) => i.food!.id)).toEqual(['oats', 'milk'])
    expect(planItemsFor(undefined, 'dinner')).toEqual([])
  })

  it('logs each food with its own new id and today\'s values for the amount', () => {
    let n = 0
    const drafts = planDrafts(planItemsFor(plan, 'breakfast'), '2026-11-23', 'breakfast', new Date('2026-11-23T08:00:00'), () => `id-${++n}`)
    expect(drafts.map((d) => d.preview.id)).toEqual(['id-1', 'id-2'])
    expect(drafts.map((d) => [d.preview.name, d.preview.meal, d.preview.date, Number(d.preview.kcal)])).toEqual([
      ['Ovsene pahuljice', 'breakfast', '2026-11-23', 227.4], ['Mleko 2%', 'breakfast', '2026-11-23', 100],
    ])
  })

  it('summarises a meal by portion name or grams', () => {
    expect(planSummary(plan, (g) => String(g))).toBe('Ovsene pahuljice 60 g · Mleko 2% 200 g · Mleko 2% 1 čaša')
  })
})

describe('editing the plan (coach)', () => {
  it('starts a new food at its first usual portion, else 100 g', () => {
    expect(newPlanItem('breakfast', oats)).toEqual({ meal: 'breakfast', food_id: 'oats', name: 'Ovsene pahuljice', grams: '81', portion_name: '1 šolja' })
    expect(newPlanItem('snack', milk)).toMatchObject({ grams: '100', portion_name: '' })
  })

  it('edits what the server saved', () => {
    const draft = fromServer({ access: {} as never, allowed: true, updated_at: 'x', items: plan })
    expect(draft[0]).toEqual({ meal: 'breakfast', food_id: 'oats', name: 'Ovsene pahuljice', grams: '60', portion_name: '' })
  })
})
