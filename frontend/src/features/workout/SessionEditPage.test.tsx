import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkoutSession } from './api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('../../i18n', () => ({ default: { language: 'sr-Latn' } }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ me: { id: 'u1' } }) }))
vi.mock('../training/ExerciseHeading', () => ({ ExerciseHeading: () => null }))

const query = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  useSession: () => query.value,
  useEditSession: () => ({ isPending: false, mutate: vi.fn() }),
}))

import { storeEditDraft, sessionToEditDraft } from './edit'
import { SessionEditPage } from './SessionEditPage'

const session: WorkoutSession = {
  id: 's1', routine_id: null, name: 'Snaga', started_at: '2026-11-17T10:00:00Z', finished_at: '2026-11-17T11:00:00Z',
  feeling: null, notes: 'server', updated_at: '2026-11-17T12:00:00Z', edited_at: null, exercises: [],
}

const render = () => renderToStaticMarkup(
  <MemoryRouter initialEntries={['/trening/istorija/s1/izmena']}>
    <Routes><Route path="/trening/istorija/:id/izmena" element={<SessionEditPage />} /></Routes>
  </MemoryRouter>,
)

afterEach(() => vi.unstubAllGlobals())

describe('workout correction page', () => {
  it('keeps the open editor when a later background refetch fails', () => {
    // React Query after a failed refetch: error status, but the fresh data is still there.
    query.value = { data: session, dataUpdatedAt: Date.now() + 60_000, isError: true, isSuccess: false, error: new Error('offline') }
    const html = render()
    expect(html).toContain('history.edit.save')
    expect(html).not.toContain('history.notFound')
    expect(html).not.toContain('history.edit.offline')
  })

  it('waits for a version fetched after opening instead of a cached copy', () => {
    query.value = { data: session, dataUpdatedAt: Date.now() - 10_000, isError: false, isSuccess: true }
    expect(render()).not.toContain('history.edit.save')
  })

  it('offers keep or discard for a kept draft made against an older revision, with the form locked', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    storeEditDraft('u1', { ...sessionToEditDraft({ ...session, updated_at: '2026-11-17T11:30:00Z' }), notes: 'moje' })
    query.value = { data: session, dataUpdatedAt: Date.now() + 60_000, isError: false, isSuccess: true }
    const html = render()
    expect(html).toContain('history.edit.staleDraft')
    expect(html).toContain('history.edit.staleKeep')
    expect(html).toMatch(/<fieldset[^>]*disabled=""/)
    // Rendering the choice does not consume the kept draft.
    expect(store.size).toBe(1)
  })
})
