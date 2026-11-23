import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../lib/db'
import type { WorkoutSession } from './api'
import { CACHED_SESSIONS, cachedHistory, forgetCachedSession, saveHistory } from './historyCache'
import { clearLocalData } from './localData'

const session = (i: number): WorkoutSession => ({
  id: `s${i}`, routine_id: null, name: `T${i}`,
  started_at: new Date(Date.UTC(2026, 10, 1, 10) + i * 3600_000).toISOString(),
  finished_at: new Date(Date.UTC(2026, 10, 1, 11) + i * 3600_000).toISOString(),
  feeling: null, notes: '', exercises: [],
})

beforeEach(async () => {
  await db.historyCache.clear()
})

describe('workout history without internet', () => {
  it('keeps the latest 30 workouts, newest first, per account', async () => {
    await saveHistory('a', Array.from({ length: 45 }, (_, i) => session(i)))
    const kept = await cachedHistory('a')
    expect(kept).toHaveLength(CACHED_SESSIONS)
    expect(kept![0].id).toBe('s44')
    expect(kept!.at(-1)!.id).toBe('s15')
    expect(await cachedHistory('b')).toBeNull()
  })

  it('each load replaces the copy, so it follows the server', async () => {
    await saveHistory('a', [session(1), session(2)])
    await saveHistory('a', [session(3)])
    expect((await cachedHistory('a'))!.map((s) => s.id)).toEqual(['s3'])
  })

  it('a deleted workout leaves the copy', async () => {
    await saveHistory('a', [session(1), session(2)])
    await forgetCachedSession('s1')
    expect((await cachedHistory('a'))!.map((s) => s.id)).toEqual(['s2'])
  })

  it('logging out removes this account’s copy only', async () => {
    await saveHistory('a', [session(1)])
    await saveHistory('b', [session(2)])
    await clearLocalData('a')
    expect(await cachedHistory('a')).toBeNull()
    expect(await cachedHistory('b')).not.toBeNull()
  })
})
