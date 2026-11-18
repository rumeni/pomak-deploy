import { QueryClient } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { cachedClientIsCurrent, isAccessRevoked, isNetworkFailure, purgeClient } from './access'

const state: { client: Record<string, unknown>; activeConnectionId?: string } = { client: {} }

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
      data: { role: 'coach', clients: state.activeConnectionId ? [{ id: state.activeConnectionId, client: { id: 'client-1' } }] : [] },
    }),
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

const cached = (connectionId = 'conn-1') => ({
  connection: {
    id: connectionId, status: 'active', connected_at: '2026-11-01T10:00:00Z', share_readiness: true,
    client: { id: 'client-1', name: 'Ana' }, coach: { id: 'coach-1', name: 'Coach' },
  },
  workouts_30d: 3,
  recent_workouts: [{ id: 'w1', name: 'SECRET WORKOUT', started_at: '2026-11-17T10:00:00Z', finished_at: '2026-11-17T11:00:00Z', feeling: null, notes: '', readiness: null, exercises: [] }],
  goals: [], measurements: null, nutrition_days: null, assignments: [],
})

const render = () => renderToStaticMarkup(<MemoryRouter><ClientDetail clientId="client-1" /></MemoryRouter>)

describe('a coach who lost access', () => {
  it('tells revoked access (401/403/404) from a network failure', () => {
    expect(isAccessRevoked(httpError(404))).toBe(true)
    expect(isAccessRevoked(httpError(403))).toBe(true)
    expect(isAccessRevoked(httpError(500))).toBe(false)
    expect(isAccessRevoked(httpError())).toBe(false)
    expect(isNetworkFailure(httpError())).toBe(true)
    expect(isNetworkFailure(httpError(404))).toBe(false)
  })

  it('never sees cached data after the client ended the collaboration', () => {
    state.activeConnectionId = 'conn-1'
    state.client = { isLoading: false, isError: true, error: httpError(404), data: cached() }
    const html = render()
    expect(html).not.toContain('SECRET WORKOUT')
    expect(html).toContain('coachSpace.client.noAccess')
  })

  it('keeps the last loaded view only for a network failure, marked as such', () => {
    state.activeConnectionId = 'conn-1'
    state.client = { isLoading: false, isError: true, error: httpError(), data: cached() }
    const html = render()
    expect(html).toContain('SECRET WORKOUT')
    expect(html).toContain('coachSpace.offlineShowingSaved')
  })

  it('does not show data of an earlier collaboration after reconnecting', () => {
    state.activeConnectionId = 'conn-2'
    state.client = { isLoading: false, isError: false, error: null, data: cached('conn-1'), isFetching: true }
    expect(render()).not.toContain('SECRET WORKOUT')
    expect(cachedClientIsCurrent('conn-1', 'conn-2')).toBe(false)
    expect(cachedClientIsCurrent('conn-1', undefined)).toBe(true)
    expect(cachedClientIsCurrent(undefined, 'conn-1')).toBe(false)
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
