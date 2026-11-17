import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../lib/db'
import { sessionToEditDraft, storeEditDraft } from './edit'
import { clearLocalData, unsentSummary } from './localData'

beforeEach(async () => {
  await db.outbox.clear()
  await db.activeWorkout.clear()
})

describe('owner data cleanup after a queued remote deletion (#47)', () => {
  const makeRow = (id: string, ownerId: string, deleteRequested: boolean) => ({
    id, ownerId, attempts: 1, error: null,
    deleteRequested, queuedAt: new Date().toISOString(),
    exercises: [], payload: {
      id, routine_id: null, name: '', started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(), plan_snapshot: null, feeling: null,
      notes: '', exercises: [],
    },
  })

  it('retains only deletion tombstones on logout so they can be retried', async () => {
    await db.outbox.put(makeRow('cancel', 'u1', true))
    await db.outbox.put(makeRow('pending', 'u1', false))
    await db.outbox.put(makeRow('other', 'u2', false))
    expect((await unsentSummary('u1')).pending).toBe(2)
    await clearLocalData('u1')
    expect((await db.outbox.get('cancel'))?.deleteRequested).toBe(true)
    expect(await db.outbox.get('pending')).toBeUndefined()
    expect(await db.outbox.get('other')).toBeDefined()
  })

  it('purges even tombstones after the account was permanently deleted', async () => {
    await db.outbox.put(makeRow('cancel', 'u1', true))
    await clearLocalData('u1', true)
    expect(await db.outbox.get('cancel')).toBeUndefined()
  })
})

describe('unsaved workout corrections are personal data', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    })
  })
  afterEach(() => {
    store.clear()
    vi.unstubAllGlobals()
  })
  const draft = (id: string) => sessionToEditDraft({
    id, routine_id: null, name: 'A', started_at: '2026-11-17T10:00:00Z', finished_at: '2026-11-17T11:00:00Z',
    feeling: null, notes: 'x', updated_at: '2026-11-17T11:00:00Z', exercises: [],
  })

  it('are counted in the logout warning and removed on logout', async () => {
    storeEditDraft('u1', draft('a'))
    storeEditDraft('u2', draft('b'))
    expect((await unsentSummary('u1')).pending).toBe(1)
    await clearLocalData('u1')
    expect([...store.keys()]).toEqual(['pomak.sessionEdit.u2.b'])
  })

  it('are removed when the account is deleted', async () => {
    storeEditDraft('u1', draft('a'))
    await clearLocalData('u1', true)
    expect(store.size).toBe(0)
  })
})

