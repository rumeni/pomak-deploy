import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from './db'

afterEach(async () => {
  db.close()
  await db.delete()
})

describe('IndexedDB active workout migration', () => {
  it('preserves the owner and confirmed sets of a v3 current workout', async () => {
    db.close()
    await db.delete()
    const legacy = new Dexie('pomak')
    legacy.version(3).stores({
      activeWorkout: 'slot',
      outbox: 'id, ownerId',
      diaryDays: 'key, ownerId',
      diaryOps: 'id, [ownerId+date], ownerId, seq',
      foodCache: 'key, ownerId, usedAt',
    })
    await legacy.open()
    await legacy.table('activeWorkout').put({
      slot: 'current', ownerId: 'u1',
      workout: { id: 'saved-uuid', exercises: [{ sets: [{ done: true, reps: '12' }] }] },
    })
    legacy.close()

    await db.open()
    expect(await db.activeWorkout.get('current')).toBeUndefined()
    const migrated = await db.activeWorkout.get('u1')
    expect(migrated?.slot).toBe('u1')
    expect(migrated?.ownerId).toBe('u1')
    expect(migrated?.workout.id).toBe('saved-uuid')
    expect(migrated?.workout.exercises[0].sets[0].reps).toBe('12')
  })
})
