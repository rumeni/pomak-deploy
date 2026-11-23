// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MyMealPlan } from '../coach/mealPlanApi'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key}(${Object.values(o).join('|')})` : key) }),
}))
vi.mock('../../lib/api', () => ({ errorMessage: (e: unknown) => `failed: ${(e as Error).message}` }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ me: { id: 'u1', profile: { is_coach: false } } }) }))
let plan: MyMealPlan | null = null
vi.mock('../coach/mealPlanApi', () => ({ useMyMealPlan: () => ({ data: plan }) }))
const saveDrafts = vi.fn()
const rememberFood = vi.fn()
vi.mock('./store', () => ({ saveDrafts: (...a: unknown[]) => saveDrafts(...a), rememberFood: (...a: unknown[]) => rememberFood(...a) }))

const { CoachPlanRow } = await import('./CoachPlanRow')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const oats = {
  id: 'oats', name: 'Ovsene pahuljice', aliases: '', source: 'usda' as const, source_ref: '', state: 'na' as const, kcal: '379',
  protein_g: '13.2', carbs_g: '67.7', fat_g: '6.5', fiber_g: '10.1', portions: [], is_custom: false,
}
const item = (meal: 'breakfast' | 'lunch', grams: string) => ({
  meal, food: oats, grams, portion_name: '', name: '', kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null,
})

let container: HTMLDivElement
let root: Root
const notices: string[] = []

beforeEach(() => {
  saveDrafts.mockReset().mockResolvedValue(undefined)
  rememberFood.mockReset().mockResolvedValue(undefined)
  notices.length = 0
  plan = { coach_name: 'Nina', updated_at: '2026-11-23T08:00:00Z', items: [item('breakfast', '60.0'), item('lunch', '100.0')] }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (meal: 'breakfast' | 'dinner') =>
  act(() => root.render(<CoachPlanRow date="2026-11-23" meal={meal} onNotice={(m) => notices.push(m)} />))

describe('the coach\'s plan in the diary', () => {
  it('shows the plan for this meal and logs it with one tap', async () => {
    render('breakfast')
    expect(container.textContent).toContain('diary.coachPlan(Nina)')
    expect(container.textContent).toContain('Ovsene pahuljice 60 g')
    await act(async () => container.querySelector('button')!.click())
    expect(saveDrafts).toHaveBeenCalledOnce()
    const [owner, drafts] = saveDrafts.mock.calls[0] as [string, { preview: { meal: string; kcal: string } }[]]
    expect(owner).toBe('u1')
    // Only this meal's foods, with values taken from the food now (a snapshot like any entry).
    expect(drafts.map((d) => [d.preview.meal, Number(d.preview.kcal)])).toEqual([['breakfast', 227.4]])
    expect(notices).toEqual(['diary.planLogged(1)'])
  })

  it('shows the error and allows another try when saving fails', async () => {
    saveDrafts.mockRejectedValueOnce(new Error('disk full'))
    render('breakfast')
    await act(async () => container.querySelector('button')!.click())
    expect(container.textContent).toContain('failed: disk full')
    expect(container.querySelector('button')!.disabled).toBe(false)
  })

  it('shows nothing for a meal without plan items or without a plan', () => {
    render('dinner')
    expect(container.innerHTML).toBe('')
    plan = null
    render('breakfast')
    expect(container.innerHTML).toBe('')
  })
})
