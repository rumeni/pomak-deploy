/**
 * Sledeća rutina: posle one koja je poslednja odrađena, redom kao u listi rutina (ukrug).
 * Bez odrađenih treninga iz rutine predlaže se prva rutina.
 */
import type { OutboxRow } from '../../lib/db'

export interface RecentWorkout {
  id: string
  name: string
  routine_id: string | null
  started_at: string
}

/** Canonical sent workouts plus valid offline entries for the home card. */
export function sessionsWithPending(server: RecentWorkout[], outbox: OutboxRow[]): RecentWorkout[] {
  const deletingIds = new Set(outbox.filter((row) => row.deleteRequested).map((row) => row.id))
  const remote = server.filter((row) => !deletingIds.has(row.id))
  const remoteIds = new Set(remote.map((row) => row.id))
  const queued = outbox
    .filter((row) => !row.deleteRequested && !row.error && !remoteIds.has(row.id))
    .map((row) => ({
      id: row.id, name: row.payload.name,
      routine_id: row.payload.routine_id, started_at: row.payload.started_at,
    }))
  return [...remote, ...queued].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
}

export function nextRoutine<R extends { id: string }>(routines: R[], sessions: { routine_id: string | null; started_at: string }[]): R | null {
  if (!routines.length) return null
  const last = [...sessions]
    .filter((s) => s.routine_id && routines.some((r) => r.id === s.routine_id))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0]
  if (!last) return routines[0]
  const i = routines.findIndex((r) => r.id === last.routine_id)
  return routines[(i + 1) % routines.length]
}
