import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ClientMealPlan } from './mealPlanApi'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key}(${Object.values(o).join('|')})` : key) }),
}))
vi.mock('../../lib/api', () => ({ errorMessage: String }))
vi.mock('../nutrition/api', () => ({ useFoods: () => ({ data: [] }) }))
vi.mock('./guard', () => ({ useClientGuard: () => ({ state: 'ok' }) }))
let plan: ClientMealPlan
vi.mock('./mealPlanApi', () => ({
  useClientMealPlan: () => ({ data: plan, isLoading: false, isError: false }),
  useSaveMealPlan: () => ({ isPending: false, isSuccess: false, error: null, mutate: vi.fn() }),
}))

import { MealPlanPanel } from './MealPlanPanel'

const oats = {
  id: 'oats', name: 'Ovsene pahuljice', aliases: '', source: 'usda' as const, source_ref: '', state: 'na' as const, kcal: '379',
  protein_g: '13.2', carbs_g: '67.7', fat_g: '6.5', fiber_g: null, portions: [], is_custom: false,
}

describe('the coach\'s meal plan editor', () => {
  it('lists the saved foods per meal with editable amounts', () => {
    plan = {
      access: { connection_id: 'c1' } as never, allowed: true, updated_at: '2026-11-23T08:00:00Z',
      items: [{ meal: 'breakfast', food: oats, grams: '60.0', portion_name: '', name: '', kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null }],
    }
    const html = renderToStaticMarkup(<MealPlanPanel clientId="ana" />)
    expect(html).toContain('coachSpace.mealPlan.title')
    expect(html).toContain('Ovsene pahuljice')
    expect(html).toContain('value="60"')
    expect(html).toContain('coachSpace.mealPlan.addFood')
    expect(html).toContain('coachSpace.mealPlan.save')
  })

  it('explains that the client has not allowed it and offers no editor', () => {
    plan = { access: { connection_id: 'c1' } as never, allowed: false, updated_at: null, items: [] }
    const html = renderToStaticMarkup(<MealPlanPanel clientId="ana" />)
    expect(html).toContain('coachSpace.mealPlan.notAllowed')
    expect(html).not.toContain('coachSpace.mealPlan.save')
  })
})
