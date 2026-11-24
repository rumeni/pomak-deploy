import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      if (key === 'diary.unknownMacro') return `${opts?.count} without data`
      if (key === 'diary.unknownNote') return 'Only known values are summed'
      return key
    },
  }),
}))

import { CoachNutritionDays } from './CoachNutritionDays'

describe('coach nutrition view does not understate unknown macro totals', () => {
  it('renders all three known macro sums and missing counts only where needed', () => {
    const html = renderToStaticMarkup(<CoachNutritionDays days={[
      {
        date: '2026-11-16', kcal: '600.0', protein_g: '25.00', carbs_g: null,
        fat_g: '8.00', protein_unknown: 1, carbs_unknown: 2, fat_unknown: 0,
      },
      {
        date: '2026-11-15', kcal: '400.0', protein_g: '40.00', carbs_g: '20.00',
        fat_g: '10.00', protein_unknown: 0, carbs_unknown: 0, fat_unknown: 0,
      },
    ]} />)
    expect(html).toContain('2026-11-16')
    expect(html).toContain('600 kcal')
    expect(html).toContain('25 g')
    expect(html).toContain('8 g')
    expect(html).toContain('nutrition.carbs')
    expect(html).toContain('–')
    expect(html).toContain('1 without data')
    expect(html).toContain('2 without data')
    expect(html.match(/Only known values are summed/g)).toHaveLength(1)
    expect(html).toContain('2026-11-15')
    expect(html).toContain('400 kcal')
  })
})
