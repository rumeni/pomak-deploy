import { QueryClient } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isAccessRevoked, isNetworkFailure, isRevoked, purgeClient, redactCached, resetRevoked, viewableClient,
  visibleTaskList, type AccessRow, type DashboardAccess,
} from './access'
import type { CoachTask } from './tasks'

const state: { client: Record<string, unknown>; dashboard?: Record<string, unknown> } = { client: {} }

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'sr-Latn' } }) }))
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ removeQueries: vi.fn(), invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}))
vi.mock('../training/api', () => ({ useRoutines: () => ({ data: [] }) }))
vi.mock('../../lib/api', () => ({ errorMessage: (error: unknown) => String(error) }))
vi.mock('./api', () => {
  const idle = { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }
  return {
    useCoachClient: () => state.client,
    useCoachDashboard: () => ({ data: state.dashboard }),
    useCoachTasks: () => ({ data: [] }),
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

const CONNECTED = '2026-11-01T10:00:00Z'

const detail = ({ id = 'conn-1', version = 1, connectedAt = CONNECTED } = {}) => ({
  connection: {
    id, status: 'active' as const, connected_at: connectedAt, access_version: version,
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
  id: 'conn-1', client: { id: 'client-1' }, share_measurements: true, share_nutrition: true, share_readiness: true,
  access_version: 1, connected_at: CONNECTED, ...patch,
})

const dash = (rows: AccessRow[], extra: Partial<DashboardAccess> = {}): DashboardAccess => ({
  rows, archivedIds: [], serverTime: '2026-11-18T12:00:00Z', ...extra,
})

const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/x?tab=progress']}><ClientDetail clientId="client-1" /></MemoryRouter>)
const show = (client: Record<string, unknown>, access?: DashboardAccess) => {
  state.client = { isLoading: false, isError: false, error: null, ...client }
  state.dashboard = access
    ? { role: 'coach', clients: access.rows, archived_clients: access.archivedIds.map((id) => ({ id })), server_time: access.serverTime }
    : undefined
}

describe('what a coach may see is ordered by server facts, not by arrival', () => {
  beforeEach(() => resetRevoked())

  it('tells revoked access from a network failure', () => {
    expect(isAccessRevoked(httpError(404))).toBe(true)
    expect(isAccessRevoked(httpError(500))).toBe(false)
    expect(isNetworkFailure(httpError())).toBe(true)
    expect(isNetworkFailure(httpError(404))).toBe(false)
  })

  it('a client response that was in flight during a revocation stays redacted when it arrives last', () => {
    // The dashboard already knows version 2 (readiness and measurements withdrawn); the client
    // data requested before that arrives afterwards, read at version 1.
    const view = viewableClient(detail({ version: 1 }), {
      error: null, dashboard: dash([row({ access_version: 2, share_readiness: false, share_measurements: false })]),
    })
    expect(view.data?.recent_workouts[0].readiness).toBeNull()
    expect(view.data?.measurements).toBeNull()
    expect(view.data?.recent_workouts[0].name).toBe('SECRET WORKOUT')
    expect(view.refresh).toBe(true)
    show({ data: detail({ version: 1 }) }, dash([row({ access_version: 2, share_readiness: false, share_measurements: false })]))
    const html = render()
    expect(html).not.toContain('74.2')
    expect(html).not.toContain('Spremnost')
  })

  it('consent given again does not unmask old cached data when the fresh fetch fails', () => {
    // Revoked at version 2, regranted at version 3; the cache still holds version 1 data and
    // the refetch fails (offline).
    const view = viewableClient(detail({ version: 1 }), {
      error: httpError(), dashboard: dash([row({ access_version: 3 })]),
    })
    expect(view.data?.measurements).toBeNull()
    expect(view.data?.recent_workouts[0].readiness).toBeNull()
    expect(view.redactWith?.access_version).toBe(3)
  })

  it('removes withdrawn categories from the cache itself', () => {
    const cleaned = redactCached(detail(), row({ share_measurements: false, share_readiness: false }))
    expect(cleaned.measurements).toBeNull()
    expect(cleaned.recent_workouts[0].readiness).toBeNull()
    expect(cleaned.nutrition_days).toEqual([])
  })

  it('an ended, replaced or vanished collaboration shows nothing, whatever arrives later', () => {
    expect(viewableClient(detail(), { error: httpError(), dashboard: dash([], { archivedIds: ['conn-1'] }) }).data).toBeNull()
    expect(isRevoked('conn-1')).toBe(true)
    // Revoked for good: a late successful response of that collaboration is still refused.
    expect(viewableClient(detail(), { error: null, dashboard: undefined }).purge).toBe(true)
    resetRevoked()
    expect(viewableClient(detail(), { error: null, dashboard: dash([row({ id: 'conn-2', connected_at: '2026-11-10T10:00:00Z' })]) }).purge).toBe(true)
    resetRevoked()
    expect(viewableClient(detail(), { error: null, dashboard: dash([]) }).purge).toBe(true)
  })

  it('a 403/404 revokes that collaboration for good', () => {
    viewableClient(detail(), { error: httpError(404), dashboard: undefined })
    expect(viewableClient(detail(), { error: null, dashboard: dash([row()]) }).data).toBeNull()
  })

  it('a dashboard older than the collaboration does not hide it, and offline shows the last view', () => {
    const fresh = viewableClient(detail({ connectedAt: '2026-11-18T13:00:00Z' }), { error: null, dashboard: dash([]) })
    expect(fresh.data).not.toBeNull()
    show({ isError: true, error: httpError(), data: detail() }, undefined)
    const html = render()
    expect(html).toContain('SECRET WORKOUT')
    expect(html).toContain('coachSpace.offlineShowingSaved')
  })

  it('tasks are judged by their own collaboration and access version', () => {
    const task = (id: string, kind: CoachTask['kind'], version = 1, connection = 'conn-1'): CoachTask => ({
      id, kind, state: 'open', snoozed_until: null, resolved_at: null, event_at: '2026-11-18T10:00:00Z', data: {},
      client: { id: 'client-1', name: 'Ana' },
      connection: { id: connection, access_version: version, connected_at: CONNECTED },
    })
    const tasks = [task('review', 'workout_review'), task('ready-old', 'low_readiness', 1), task('ready-new', 'low_readiness', 3)]
    // Regranted at version 3: the readiness task read at version 1 stays hidden, the fresh one shows.
    expect(visibleTaskList(tasks, dash([row({ access_version: 3 })])).map((t) => t.id)).toEqual(['review', 'ready-new'])
    // Withdrawn: no readiness task at all, even one read later than the dashboard.
    expect(visibleTaskList(tasks, dash([row({ access_version: 2, share_readiness: false })])).map((t) => t.id)).toEqual(['review', 'ready-new'])
    expect(visibleTaskList([task('ready', 'low_readiness', 2)], dash([row({ access_version: 2, share_readiness: false })]))).toEqual([])
    // Ended: nothing of that collaboration.
    expect(visibleTaskList(tasks, dash([], { archivedIds: ['conn-1'] }))).toEqual([])
  })

  it('forgets everything cached about that client', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['coach-client', 'client-1'], detail())
    qc.setQueryData(['coach-messages', 'client-1'], { pages: [] })
    qc.setQueryData(['coach-client', 'client-2'], detail())
    await purgeClient(qc, 'client-1')
    expect(qc.getQueryData(['coach-client', 'client-1'])).toBeUndefined()
    expect(qc.getQueryData(['coach-messages', 'client-1'])).toBeUndefined()
    expect(qc.getQueryData(['coach-client', 'client-2'])).toBeDefined()
  })
})
