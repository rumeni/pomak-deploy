import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../../lib/db'
import type { WorkoutSession } from './api'

/** How many of the latest workouts stay on the phone for the history without internet. */
export const CACHED_SESSIONS = 30

/**
 * Keeps the newest workouts the server returned (newest first) on this device, per account.
 * Called whenever the history loads, so the copy is refreshed each time the app is online.
 */
export async function saveHistory(ownerId: string, sessions: WorkoutSession[]): Promise<void> {
  const newest = [...sessions]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, CACHED_SESSIONS)
  await db.historyCache.put({ key: ownerId, ownerId, sessions: newest, savedAt: new Date().toISOString() })
}

/** A deleted workout must not come back from the copy (workout IDs are unique across accounts). */
export async function forgetCachedSession(id: string): Promise<void> {
  await db.transaction('rw', db.historyCache, async () => {
    for (const row of await db.historyCache.toArray()) {
      if (row.sessions.some((s) => s.id === id)) {
        await db.historyCache.put({ ...row, sessions: row.sessions.filter((s) => s.id !== id) })
      }
    }
  })
}

export async function cachedHistory(ownerId: string): Promise<WorkoutSession[] | null> {
  const row = await db.historyCache.get(ownerId)
  return row?.ownerId === ownerId ? row.sessions : null
}

/** The copy on this device: null while it is read or when there is none. */
export function useCachedHistory(ownerId: string | undefined): WorkoutSession[] | null {
  return useLiveQuery(async () => (ownerId ? cachedHistory(ownerId) : null), [ownerId]) ?? null
}
