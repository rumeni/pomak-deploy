import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ me: { id: 'u1', profile: { meals: null } } }),
}))
vi.mock('../../lib/api', () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unknown error',
}))
vi.mock('../../components/LanguageMenu', () => ({ LanguageMenu: () => null }))
vi.mock('../nutrition/api', () => ({
  useFoods: () => ({ data: [], isError: false }),
}))
vi.mock('./store', () => ({
  useDiaryDay: () => ({
    offline: false,
    day: {
      date: '2026-11-16', status: null, target: null, statusPending: false,
      pendingIds: new Set(), errors: new Map(),
      entries: [{
        id: 'entry1', date: '2026-11-16', meal: 'breakfast',
        food_id: null, name: 'Breakfast', grams: null, portion_name: '',
        per100_kcal: null, per100_protein_g: null, per100_carbs_g: null,
        per100_fat_g: null, per100_fiber_g: null,
        kcal: '300.0', protein_g: null, carbs_g: null, fat_g: null, fiber_g: null,
        created_at: '2026-11-16T10:00:00Z',
      }],
    },
  }),
  useRecentFoods: () => [],
  loadDayEntries: vi.fn(),
  saveDrafts: vi.fn(),
  setDayStatus: vi.fn(),
  discardRejectedDayOps: vi.fn(),
  rememberFood: vi.fn(),
}))
vi.mock('./api', () => ({
  useCreateSavedMeal: () => ({
    error: new Error('Save failed: offline'), isPending: false,
    mutate: vi.fn(), reset: vi.fn(),
  }),
  useSavedMeals: () => ({
    data: [{ id: 'saved1', name: 'Breakfast', items: [] }], isError: false,
  }),
  useDeleteSavedMeal: () => ({
    error: new Error('Delete failed: offline'), isPending: false, mutate: vi.fn(),
  }),
}))
vi.mock('../coach/api', () => ({
  useCoachDashboard: () => ({
    isLoading: false, isError: false,
    data: {
      role: 'client', invitations: [], clients: [],
      connection: {
        id: 'connection1', coach: { name: 'Coach' }, client: { id: 'u1' },
        connected_at: '2026-11-01T10:00:00Z', share_measurements: false, share_nutrition: false,
      },
      assignments: [],
    },
  }),
  useConnectCoach: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDisconnectCoach: () => ({ mutate: vi.fn(), isPending: false, error: new Error('Disconnect failed: offline') }),
  useUpdateCoachSharing: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))
vi.mock('../coach/CoachMessages', () => ({ CoachMessages: () => null }))
vi.mock('../coach/MyPlanCard', () => ({ MyPlanCard: () => null }))
vi.mock('../schedule/MyBookingsCard', () => ({ MyBookingsCard: () => null }))

import { DiaryPage } from './DiaryPage'
import { AddEntryPage } from './AddEntryPage'
import { CoachPage } from '../coach/CoachPage'

describe('failed online-only mutations are visible to the user', () => {
  it('displays saved-meal creation errors next to the diary action', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ishrana?datum=2026-11-16']}>
        <DiaryPage />
      </MemoryRouter>,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Save failed: offline')
  })

  it('displays deletion errors near the saved-meal list', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ishrana/dodaj?datum=2026-11-16&obrok=breakfast']}>
        <AddEntryPage />
      </MemoryRouter>,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Delete failed: offline')
  })

  it('displays trainer-disconnect errors without removing the active connection', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/trener']}>
        <CoachPage />
      </MemoryRouter>,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Disconnect failed: offline')
    expect(html).toContain('Coach')
  })
})
