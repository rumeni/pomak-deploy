import { QueryClient } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  accessRegistry, dashboardAccess, isAccessRevoked, isNetworkFailure, purgeClient, redactCached, viewableClient,
  visibleTaskList, type AccessRegistry, type AccessRow,
} from './access'
import type { CoachTask } from './tasks'

const state: { client: Record<string, unknown>; dashboard?: Record<string, unknown>; tasks: CoachTask[]; qc: QueryClient } = {
  client: {}, tasks: [], qc: new QueryClient(),
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'sr-Latn' } }) }))
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => state.qc,
}))
vi.mock('../training/api', () => ({ useRoutines: () => ({ data: [] }) }))
vi.mock('../../lib/api', () => ({ errorMessage: (error: unknown) => String(error) }))
vi.mock('./api', () => {
  const idle = { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }
  return {
    useCoachClient: () => state.client,
    useCoachDashboard: () => ({ data: state.dashboard }),
    useCoachTasks: () => ({ data: state.tasks }),
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

const detail = ({ id = 'conn-1', version = 1, connectedAt = CONNECTED, readiness = true, measurements = true } = {}) => ({
  connection: {
    id, status: 'active' as const, connected_at: connectedAt, access_version: version,
    share_measurements: measurements, share_nutrition: true, share_readiness: readiness,
    client: { id: 'client-1', name: 'Ana' }, coach: { id: 'coach-1', name: 'Coach' },
  },
  workouts_30d: 3,
  recent_workouts: [{
    id: 'w1', name: 'SECRET WORKOUT', started_at: '2026-11-17T10:00:00Z', finished_at: '2026-11-17T11:00:00Z',
    feeling: null, notes: '', readiness: readiness ? { score: 38, answers: { sleep_hours: 4 } } : null, exercises: [],
  }],
  goals: [{ kind: 'weight', target_value: '70', target_date: null }],
  measurements: measurements ? [{ kind: 'weight', value: '74.2', unit: 'kg', measured_on: '2026-11-17' }] : null,
  nutrition_days: [],
  assignments: [],
})

const row = (patch: Partial<AccessRow> = {}): AccessRow => ({
  id: 'conn-1', client: { id: 'client-1' }, share_measurements: true, share_nutrition: true, share_readiness: true,
  access_version: 1, connected_at: CONNECTED, ...patch,
})

const dashboardData = (rows: AccessRow[], archived: string[] = [], serverTime = '2026-11-18T12:00:00Z') =>
  ({ role: 'coach', clients: rows, archived_clients: archived.map((id) => ({ id })), server_time: serverTime })

const task = (id: string, kind: CoachTask['kind'], version = 1, connection = 'conn-1'): CoachTask => ({
  id, kind, state: 'open', snoozed_until: null, resolved_at: null, event_at: '2026-11-18T10:00:00Z',
  data: { workout: 'Upper A', score: 31, answers: { sleep_hours: 4 } },
  client: { id: 'client-1', name: 'Ana' },
  connection: { id: connection, access_version: version, connected_at: CONNECTED },
})

const render = (tab = 'progress') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/x?tab=${tab}`]}><ClientDetail clientId="client-1" /></MemoryRouter>)
const show = (client: Record<string, unknown>, dashboard?: Record<string, unknown>, tasks: CoachTask[] = []) => {
  state.client = { isLoading: false, isError: false, error: null, ...client }
  state.dashboard = dashboard
  state.tasks = tasks
}

let registry: AccessRegistry

describe('coach access follows the highest server version seen from any source', () => {
  beforeEach(() => {
    state.qc = new QueryClient()
    registry = accessRegistry(state.qc)
  })

  it('tells revoked access from a network failure', () => {
    expect(isAccessRevoked(httpError(404))).toBe(true)
    expect(isAccessRevoked(httpError(500))).toBe(false)
    expect(isNetworkFailure(httpError())).toBe(true)
    expect(isNetworkFailure(httpError(404))).toBe(false)
  })

  it('a newer client screen hides an older readiness task at once, and after navigating away', () => {
    // Dashboard and tasks still at v1 (readiness shared); the 15 s client refetch already got v2
    // with readiness withdrawn.
    show({ data: detail({ version: 2, readiness: false }) }, dashboardData([row()]), [task('ready-v1', 'low_readiness', 1), task('review', 'workout_review', 1)])
    const html = render('overview')
    expect(html).not.toContain('coachSpace.task.lowReadiness')
    expect(html).toContain('coachSpace.task.workoutReview')
    // Elsewhere (the overview), with the same old dashboard and tasks: still hidden.
    const later = visibleTaskList(state.tasks, dashboardAccess(dashboardData([row()]), registry), registry)
    expect(later.map((t) => t.id)).toEqual(['review'])
    expect(registry.known.get('conn-1')?.access_version).toBe(2)
  })

  it('an older source never lowers the known version', () => {
    viewableClient(detail({ version: 3 }), { error: null, dashboard: undefined, registry })
    dashboardAccess(dashboardData([row({ access_version: 1, share_readiness: false })]), registry)
    expect(registry.known.get('conn-1')?.access_version).toBe(3)
  })

  it('a client response that was in flight during a revocation stays redacted when it arrives last', () => {
    const dashboard = dashboardAccess(dashboardData([row({ access_version: 2, share_readiness: false, share_measurements: false })]), registry)
    const view = viewableClient(detail({ version: 1 }), { error: null, dashboard, registry })
    expect(view.data?.recent_workouts[0].readiness).toBeNull()
    expect(view.data?.measurements).toBeNull()
    expect(view.data?.recent_workouts[0].name).toBe('SECRET WORKOUT')
    expect(view.refresh).toBe(true)
    show({ data: detail({ version: 1 }) }, dashboardData([row({ access_version: 2, share_readiness: false, share_measurements: false })]))
    const html = render()
    expect(html).not.toContain('74.2')
    expect(html).not.toContain('Spremnost')
  })

  it('consent given again does not unmask old cached data when the fresh fetch fails', () => {
    const dashboard = dashboardAccess(dashboardData([row({ access_version: 3 })]), registry)
    const view = viewableClient(detail({ version: 1 }), { error: httpError(), dashboard, registry })
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
    const archived = dashboardAccess(dashboardData([], ['conn-1']), registry)
    expect(viewableClient(detail(), { error: httpError(), dashboard: archived, registry }).data).toBeNull()
    // Revoked for good: a late successful response of that collaboration is still refused.
    expect(viewableClient(detail(), { error: null, dashboard: undefined, registry }).purge).toBe(true)

    const fresh = accessRegistry(new QueryClient())
    const replaced = dashboardAccess(dashboardData([row({ id: 'conn-2', connected_at: '2026-11-10T10:00:00Z' })]), fresh)
    expect(viewableClient(detail(), { error: null, dashboard: replaced, registry: fresh }).purge).toBe(true)
    const other = accessRegistry(new QueryClient())
    expect(viewableClient(detail(), { error: null, dashboard: dashboardAccess(dashboardData([]), other), registry: other }).purge).toBe(true)
  })

  it('a 403/404 revokes that collaboration for good, a 401 does not', () => {
    viewableClient(detail(), { error: httpError(404), dashboard: undefined, registry })
    expect(viewableClient(detail(), { error: null, dashboard: dashboardAccess(dashboardData([row()]), registry), registry }).data).toBeNull()
    const other = accessRegistry(new QueryClient())
    viewableClient(detail(), { error: httpError(401), dashboard: undefined, registry: other })
    expect(other.revoked.size).toBe(0)
  })

  it('a dashboard older than the collaboration does not hide it, and offline shows the last view', () => {
    const view = viewableClient(detail({ connectedAt: '2026-11-18T13:00:00Z' }), { error: null, dashboard: dashboardAccess(dashboardData([]), registry), registry })
    expect(view.data).not.toBeNull()
    state.qc = new QueryClient()
    show({ isError: true, error: httpError(), data: detail() }, undefined)
    const html = render()
    expect(html).toContain('SECRET WORKOUT')
    expect(html).toContain('coachSpace.offlineShowingSaved')
  })

  it('tasks are judged by their own collaboration and the highest known version', () => {
    const tasks = [task('review', 'workout_review'), task('ready-old', 'low_readiness', 1), task('ready-new', 'low_readiness', 3)]
    // Regranted at version 3: the readiness task read at version 1 stays hidden, the fresh one shows.
    expect(visibleTaskList(tasks, dashboardAccess(dashboardData([row({ access_version: 3 })]), registry), registry).map((t) => t.id))
      .toEqual(['review', 'ready-new'])
    const withdrawn = accessRegistry(new QueryClient())
    const d2 = dashboardAccess(dashboardData([row({ access_version: 2, share_readiness: false })]), withdrawn)
    expect(visibleTaskList([task('ready', 'low_readiness', 2)], d2, withdrawn)).toEqual([])
    const ended = accessRegistry(new QueryClient())
    expect(visibleTaskList(tasks, dashboardAccess(dashboardData([], ['conn-1']), ended), ended)).toEqual([])
  })

  it('the registry belongs to the signed-in account: logging out clears it', () => {
    registry.known.set('conn-1', row({ access_version: 5 }))
    state.qc.clear()
    expect(accessRegistry(state.qc).known.size).toBe(0)
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
