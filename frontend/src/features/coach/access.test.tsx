import { QueryClient } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { isAccessRevoked, isNetworkFailure, purgeClient, viewableClient, visibleTaskList, type AccessRow } from './access'
import type { CoachTask } from './tasks'

const state: {
  client: Record<string, unknown>
  rows?: AccessRow[]
  dashboardUpdatedAt: number
} = { client: {}, dashboardUpdatedAt: 0 }

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'sr-Latn' } }) }))
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ removeQueries: vi.fn(), invalidateQueries: vi.fn() }),
}))
vi.mock('../training/api', () => ({ useRoutines: () => ({ data: [] }) }))
vi.mock('../../lib/api', () => ({ errorMessage: (error: unknown) => String(error) }))
vi.mock('./api', () => {
  const idle = { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }
  return {
    useCoachClient: () => state.client,
    useCoachDashboard: () => ({
      data: state.rows ? { role: 'coach', clients: state.rows } : undefined,
      dataUpdatedAt: state.dashboardUpdatedAt,
    }),
    useCoachTasks: () => ({ data: [], dataUpdatedAt: 0 }),
    useCoachNotes: () => ({ data: [] }),
    useClientStatus: () => idle,
    useAssignCoachRoutine: () => idle,
    useCreateCoachNote: () => idle,
    useUpdateCoachNote: () => idle,
    useDeleteCoachNote: () => idle,
    useDisconnectCoach: () => idle,
  }
})

import { ClientDetail } from './ClientDetail'

function httpError(status?: number) {
  const error = new AxiosError('failed')
  if (status) error.response = { status, data: {}, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } }
  return error
}

const cached = (connectionId = 'conn-1') => ({
  connection: {
    id: connectionId, status: 'active' as const, connected_at: '2026-11-01T10:00:00Z',
    share_measurements: true, share_nutrition: true, share_readiness: true,
    client: { id: 'client-1', name: 'Ana' }, coach: { id: 'coach-1', name: 'Coach' },
  },
  workouts_30d: 3,
  recent_workouts: [{
    id: 'w1', name: 'SECRET WORKOUT', started_at: '2026-11-17T10:00:00Z', finished_at: '2026-11-17T11:00:00Z',
    feeling: null, notes: '', readiness: { score: 38, answers: { sleep_hours: 4 } }, exercises: [],
  }],
  goals: [{ kind: 'weight', target_value: '70', target_date: null }],
  measurements: [{ kind: 'weight', value: '74.2', unit: 'kg', measured_on: '2026-11-17' }],
  nutrition_days: [],
  assignments: [],
})

const row = (patch: Partial<AccessRow> = {}): AccessRow => ({
  id: 'conn-1', client: { id: 'client-1' }, share_measurements: true, share_nutrition: true, share_readiness: true, ...patch,
})

const render = (tab = 'progress') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/x?tab=${tab}`]}><ClientDetail clientId="client-1" /></MemoryRouter>)
const show = (client: Record<string, unknown>, rows: AccessRow[] | undefined, dashboardUpdatedAt: number) => {
  state.client = { isLoading: false, isError: false, error: null, dataUpdatedAt: 100, ...client }
  state.rows = rows
  state.dashboardUpdatedAt = dashboardUpdatedAt
}

describe('a coach who lost access', () => {
  it('tells revoked access (401/403/404) from a network failure', () => {
    expect(isAccessRevoked(httpError(404))).toBe(true)
    expect(isAccessRevoked(httpError(403))).toBe(true)
    expect(isAccessRevoked(httpError(500))).toBe(false)
    expect(isAccessRevoked(httpError())).toBe(false)
    expect(isNetworkFailure(httpError())).toBe(true)
    expect(isNetworkFailure(httpError(404))).toBe(false)
  })

  it('never sees cached data once the server says no', () => {
    show({ isError: true, error: httpError(404), data: cached() }, [row()], 50)
    const html = render()
    expect(html).not.toContain('SECRET WORKOUT')
    expect(html).toContain('coachSpace.client.noAccess')
  })

  it('a newer dashboard without the collaboration wins over cached data, even offline', () => {
    show({ isError: true, error: httpError(), data: cached() }, [], 200)
    expect(render()).not.toContain('SECRET WORKOUT')
    expect(viewableClient(cached(), { error: httpError(), detailUpdatedAt: 100, rows: [], dashboardUpdatedAt: 200 }))
      .toEqual({ data: null, purge: true, refresh: false })
  })

  it('keeps the last view offline only while the dashboard is unknown', () => {
    show({ isError: true, error: httpError(), data: cached() }, undefined, 0)
    const html = render()
    expect(html).toContain('SECRET WORKOUT')
    expect(html).toContain('coachSpace.offlineShowingSaved')
  })

  it('hides categories the client stopped sharing, at once', () => {
    show({ data: cached() }, [row({ share_measurements: false, share_readiness: false })], 200)
    const html = render()
    expect(html).toContain('SECRET WORKOUT')
    expect(html).not.toContain('74,2')
    expect(html).not.toContain('74.2')
    expect(html).not.toContain('38')
    const view = viewableClient(cached(), { error: null, detailUpdatedAt: 100, rows: [row({ share_nutrition: false })], dashboardUpdatedAt: 200 })
    expect(view.data?.nutrition_days).toBeNull()
    expect(view.refresh).toBe(true)
  })

  it('does not show data of an earlier collaboration after reconnecting', () => {
    show({ data: cached('conn-1') }, [row({ id: 'conn-2' })], 200)
    expect(render()).not.toContain('SECRET WORKOUT')
  })

  it('trusts newer client data over an older dashboard (a client who just connected)', () => {
    const view = viewableClient(cached(), { error: null, detailUpdatedAt: 300, rows: [], dashboardUpdatedAt: 200 })
    expect(view.data).not.toBeNull()
    expect(view).toMatchObject({ purge: false, refresh: true })
  })

  it('drops tasks of clients no longer listed and readiness tasks without consent', () => {
    const task = (id: string, client: string, kind: CoachTask['kind']): CoachTask => ({
      id, kind, state: 'open', snoozed_until: null, resolved_at: null, event_at: '2026-11-18T10:00:00Z', data: {},
      client: { id: client, name: client },
    })
    const tasks = [task('a', 'client-1', 'workout_review'), task('b', 'client-1', 'low_readiness'), task('c', 'gone', 'workout_review')]
    expect(visibleTaskList(tasks, [row({ share_readiness: false })], true).map((t) => t.id)).toEqual(['a'])
    expect(visibleTaskList(tasks, [row({ share_readiness: false })], false).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('forgets everything cached about that client', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['coach-client', 'client-1'], cached())
    qc.setQueryData(['coach-messages', 'client-1'], { pages: [] })
    qc.setQueryData(['coach-client', 'client-2'], cached())
    await purgeClient(qc, 'client-1')
    expect(qc.getQueryData(['coach-client', 'client-1'])).toBeUndefined()
    expect(qc.getQueryData(['coach-messages', 'client-1'])).toBeUndefined()
    expect(qc.getQueryData(['coach-client', 'client-2'])).toBeDefined()
  })
})
