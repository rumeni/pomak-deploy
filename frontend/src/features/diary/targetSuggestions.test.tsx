import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { Food } from '../nutrition/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key}(${Object.values(o).join('|')})` : key) }),
}))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ me: { id: 'u1' } }) }))
const recent: Food[] = [{
  id: 'egg', name: 'Jaje', aliases: '', source: 'usda', source_ref: '', state: 'raw', kcal: '143', protein_g: '12.6',
  carbs_g: '0.7', fat_g: '9.5', fiber_g: null, portions: [{ name: '1 jaje', grams: '50' }], is_custom: false,
}]
vi.mock('./store', () => ({ useRecentFoods: () => recent }))

import { RemainingLine, TargetSuggestions } from './TargetSuggestions'
import type { DayTarget } from './types'

const totals = { kcal: 1180, protein: { value: 105, unknown: 0 }, carbs: { value: 110, unknown: 0 }, fat: { value: 50, unknown: 0 } }
const target: DayTarget = { valid_from: '2026-11-23', mode: 'coach', kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70, set_by_name: 'Nina' }

describe('remaining to the daily target', () => {
  it('names the coach who set the target and lists the macros still missing', () => {
    const html = renderToStaticMarkup(<RemainingLine totals={totals} target={target} />)
    expect(html).toContain('diary.remainingCoach(Nina|820)')
    expect(html).toContain('diary.macrosLeft')
    expect(html).toContain('nutrition.protein 45 g')
  })

  it('uses the plain line for an own target', () => {
    const html = renderToStaticMarkup(<RemainingLine totals={totals} target={{ ...target, mode: 'manual', set_by_name: null }} />)
    expect(html).toContain('diary.remaining(820)')
    expect(html).not.toContain('remainingCoach')
  })

  it('shows ideas from the user\'s foods that open the entry for that food', () => {
    // Carbohydrates nearly met (20 of 200 g left), so protein is what is missing most.
    const html = renderToStaticMarkup(
      <MemoryRouter><TargetSuggestions date="2026-11-23" totals={{ ...totals, carbs: { value: 180, unknown: 0 } }} target={target} settings={[]} /></MemoryRouter>,
    )
    expect(html).toContain('diary.suggestionsTitle')
    expect(html).toContain('diary.suggestionsFocus_protein')
    expect(html).toContain('/ishrana/stavka?namirnica=egg&amp;datum=2026-11-23')
    expect(html).toContain('1 jaje (50 g) · diary.suggestionMacro_protein(6,3) · 72 kcal')
  })

  it('shows nothing when there are no fitting foods', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><TargetSuggestions date="2026-11-23" totals={{ ...totals, kcal: 2000 }} target={target} settings={[]} /></MemoryRouter>,
    )
    expect(html).toBe('')
  })
})
