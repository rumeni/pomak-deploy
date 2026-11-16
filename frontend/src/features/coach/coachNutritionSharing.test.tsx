import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ me: { id: 'coach', profile: { is_coach: true } } }),
}))
vi.mock('../training/api', () => ({
  useRoutines: () => ({ data: [], isError: false }),
}))
vi.mock('./api', () => ({
  useCoachClient: () => ({
    isLoading: false, isError: false,
    data: {
      connection: {
        id: 'conn', coach: { id: 'coach', name: 'Coach' },
        client: { id: 'client', name: 'Client' }, share_nutrition: true, share_measurements: false,
      },
      workouts_30d: 0, recent_workouts: [], goals: [], measurements: null,
      nutrition_days: [
        {
          date: '2026-11-16', kcal: '600.0', protein_g: '25.00', carbs_g: null,
          fat_g: '8.00', protein_unknown: 1, carbs_unknown: 2, fat_unknown: 0,
        },
        {
          date: '2026-11-15', kcal: '400.0', protein_g: '40.00', carbs_g: '20.00',
          fat_g: '10.00', protein_unknown: 0, carbs_unknown: 0, fat_unknown: 0,
        },
      ],
      assignments: [],
    },
  }),
  useAssignCoachRoutine: () => ({ isPending: false, isError: false, error: null, mutate: vi.fn() }),
  useDisconnectCoach: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}))
vi.mock('./CoachMessages', () => ({ CoachMessages: () => null }))

import { CoachClientPage } from './CoachClientPage'

describe('coach nutrition view does not understate unknown macro totals', () => {
  it('renders all three known macro sums and counts of missing values', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/trener/klijenti/client']}>
        <Routes>
          <Route path="/trener/klijenti/:id" element={<CoachClientPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(html).toContain('2026-11-16')
    expect(html).toContain('600 kcal')
    expect(html).toContain('25 g')
    expect(html).toContain('8 g')
    expect(html).toContain('nutrition.carbs')
    expect(html).toContain('—')
    expect(html).toContain('1 without data')
    expect(html).toContain('2 without data')
    expect(html.match(/Only known values are summed/g)).toHaveLength(1)
    expect(html).toContain('2026-11-15')
    expect(html).toContain('400 kcal')
  })
})
