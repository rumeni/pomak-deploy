import { QueryClient } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessRegistry, dashboardAccess, guardVerdict, isAccessRevoked, isCollaborationChanged, isMissingResource, purgeClient, type ServerAccess } from './access'

const state: { qc: QueryClient; dashboard?: unknown; targets: Record<string, unknown>; stats: Record<string, unknown> } = {
  qc: new QueryClient(), targets: {}, stats: {},
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'sr-Latn' } }) }))
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => state.qc,
}))
vi.mock('../../lib/api', () => ({ errorMessage: (error: unknown) => String(error) }))
vi.mock('./api', () => ({ useCoachDashboard: () => ({ data: state.dashboard }) }))
vi.mock('../progress/StatsPage', () => ({
  StatsSections: ({ data }: { data: { readiness: unknown[] } }) => <p>{`readiness:${data.readiness.length}`}</p>,
}))
vi.mock('./reviewApi', () => ({
  useClientTargets: () => state.targets,
  useClientStats: () => state.stats,
  useSetClientTarget: () => ({ mutate: vi.fn(), isPending: false, error: null, isSuccess: false }),
}))

import { ClientStats, ClientTargetPanel } from './ClientTabs'

const CONNECTED = '2026-11-01T10:00:00Z'
const access = (patch: Partial<ServerAccess> = {}): ServerAccess => ({
  connection_id: 'conn-1', client_id: 'client-1', access_version: 1, connected_at: CONNECTED,
  share_measurements: true, share_nutrition: true, share_readiness: true, coach_sets_nutrition: true, ...patch,
})
const dashboard = (patch: Record<string, unknown> = {}, archived: string[] = []) => ({
  role: 'coach', server_time: '2026-11-18T12:00:00Z', archived_clients: archived.map((id) => ({ id })),
  clients: [{ id: 'conn-1', client: { id: 'client-1' }, connected_at: CONNECTED, share_measurements: true, share_nutrition: true,
    share_readiness: true, coach_sets_nutrition: true, access_version: 1, ...patch }],
})
const httpError = (status?: number, data: Record<string, unknown> = {}) => {
  const error = new AxiosError('failed')
  if (status) error.response = { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } }
  return error
}
const target = { valid_from: '2026-11-18', mode: 'coach', kcal: 2300, protein_g: 160, carbs_g: null, fat_g: null, set_by_coach: true, note: '' }
const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

describe('every coach view of client data follows the access registry', () => {
  beforeEach(() => {
    state.qc = new QueryClient()
    state.dashboard = undefined
  })

  it('a stats response read at v1 arriving after the client screen saw v2 hides readiness', () => {
    const registry = accessRegistry(state.qc)
    expect(guardVerdict(access({ access_version: 2, share_readiness: false }), null, undefined, registry).state).toBe('ok')
    state.stats = { data: { readiness: [{}, {}], totals: { sessions: 2 }, access: access() }, isError: false, error: null, isLoading: false }
    expect(render(<ClientStats clientId="client-1" />)).toContain('readiness:0')
  })

  it('a target panel never shows targets once access changed or is gone', () => {
    state.dashboard = dashboard({ access_version: 2, coach_sets_nutrition: false, share_nutrition: false })
    state.targets = { data: { allowed: true, can_set: true, current: target, next: null, access: access() }, isError: false, error: null, isLoading: false }
    expect(render(<ClientTargetPanel clientId="client-1" />)).not.toContain('2300')
    state.qc = new QueryClient()
    state.dashboard = dashboard({}, ['conn-1'])
    expect(render(<ClientTargetPanel clientId="client-1" />)).not.toContain('2300')
    state.qc = new QueryClient()
    state.dashboard = dashboard()
    expect(render(<ClientTargetPanel clientId="client-1" />)).toContain('2300')
  })

  it('a 403/404 revokes for good, also for a later successful response', () => {
    const registry = accessRegistry(state.qc)
    expect(guardVerdict(access(), httpError(404), undefined, registry).state).toBe('revoked')
    expect(guardVerdict(access(), null, dashboardAccess(dashboard(), registry), registry).state).toBe('revoked')
  })

  it('consent given again does not show what was read before it was withdrawn', () => {
    const registry = accessRegistry(state.qc)
    const known = dashboardAccess(dashboard({ access_version: 3 }), registry)
    expect(guardVerdict(access({ access_version: 1 }), httpError(), known, registry).state).toBe('stale')
    expect(guardVerdict(access({ access_version: 3 }), null, known, registry).state).toBe('ok')
  })

  it('forgets every cached view of the client', async () => {
    const qc = new QueryClient()
    for (const key of ['coach-client', 'coach-client-plan', 'coach-client-workout', 'coach-client-stats', 'coach-client-targets', 'coach-client-week']) {
      qc.setQueryData([key, 'client-1', 'x'], { secret: true })
    }
    qc.setQueryData(['coach-client-week', 'client-2', 'x'], { secret: true })
    await purgeClient(qc, 'client-1')
    expect(qc.getQueryCache().findAll().filter((q) => q.queryKey[1] === 'client-1')).toEqual([])
    expect(qc.getQueryData(['coach-client-week', 'client-2', 'x'])).toBeDefined()
  })

  it('a deleted workout (404 workout_not_found) is missing, not lost access', () => {
    const registry = accessRegistry(state.qc)
    const missing = httpError(404, { code: 'workout_not_found' })
    expect(isMissingResource(missing)).toBe(true)
    expect(isAccessRevoked(missing)).toBe(false)
    expect(guardVerdict(access(), missing, undefined, registry).state).not.toBe('revoked')
    expect(registry.revoked.size).toBe(0)
    // Fresh, valid views of the same client keep working.
    expect(guardVerdict(access(), null, dashboardAccess(dashboard(), registry), registry).state).toBe('ok')
    expect(isAccessRevoked(httpError(404, { code: 'collaboration_not_found' }))).toBe(true)
  })

  it('tells a write meant for an older collaboration apart', () => {
    expect(isCollaborationChanged(httpError(409, { code: 'collaboration_changed' }))).toBe(true)
    expect(isCollaborationChanged(httpError(409, { code: 'request_conflict' }))).toBe(false)
  })
})
