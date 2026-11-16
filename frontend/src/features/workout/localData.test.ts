import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../lib/db'
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
