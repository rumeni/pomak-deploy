import axios from 'axios'
import { useLiveQuery } from 'dexie-react-hooks'

import { db, type OutboxRow } from '../../lib/db'
import type { Exercise } from '../training/api'
import { formatDuration } from '../training/labels'
import { uuid } from '../../lib/uuid'
import { prepareSessionPayload, uploadSafePlanSnapshot, type ActiveWorkout, type PreviousPerformance, type SessionPayload } from './model'

/**
 * Završava trening: u JEDNOJ transakciji ga upisuje u red za slanje i briše aktivan trening.
 * Nema trenutka u kome trening nije nigde zapisan.
 */
export async function finishWorkout(
  ownerId: string,
  payload: SessionPayload,
  exercises: Exercise[],
  now = new Date(),
): Promise<void> {
  await db.transaction('rw', db.outbox, db.activeWorkout, async () => {
    await db.outbox.put({ id: payload.id, ownerId, payload, exercises, queuedAt: now.toISOString(), attempts: 0, error: null })
    await db.activeWorkout.delete(ownerId)
  })
}

export async function pendingSessions(ownerId: string): Promise<OutboxRow[]> {
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray()
  return rows.sort((a, b) => b.payload.started_at.localeCompare(a.payload.started_at))
}

export async function discardOutboxItem(id: string): Promise<void> {
  await db.outbox.delete(id)
}

/**
 * Reconstruct a rejected session as a fully editable active workout. The original
 * outbox row is removed only after the draft is durably stored in one transaction.
 */
export async function restoreRejectedWorkout(ownerId: string, id: string): Promise<void> {
  await db.transaction('rw', db.outbox, db.activeWorkout, async () => {
    const row = await db.outbox.get(id)
    if (!row || row.ownerId !== ownerId || !row.error) throw new Error('NOT_FOUND')
    if (await db.activeWorkout.get(ownerId)) throw new Error('ACTIVE_WORKOUT_EXISTS')

    const exercisesById = new Map(row.exercises.map((e) => [e.id, e]))
    const exercises = row.payload.exercises.filter((e) => e.sets.length).map((item) => {
      const exercise = exercisesById.get(item.exercise_id)
      if (!exercise) throw new Error('MISSING_EXERCISE')
      return {
        key: uuid(),
        exercise,
        restSeconds: 0,
        notes: item.notes,
        sets: item.sets.map((set) => ({
          key: uuid(),
          set_type: set.set_type,
          weight: set.weight_kg ?? '',
          reps: set.reps === null ? '' : String(set.reps),
          duration: set.duration_seconds === null ? '' : formatDuration(set.duration_seconds),
          distance: set.distance_m === null ? '' : String(set.distance_m / 1000),
          target: null,
          done: true,
          completedAt: set.completed_at,
        })),
      }
    })

    const workout: ActiveWorkout = {
      id: row.payload.id,
      routineId: row.payload.routine_id,
      name: row.payload.name,
      startedAt: row.payload.started_at,
      planSnapshot: uploadSafePlanSnapshot(row.payload.plan_snapshot),
      draftFeeling: row.payload.feeling,
      draftNotes: row.payload.notes,
      recoveredFinishedAt: row.payload.finished_at,
      exercises,
      previous: {},
      rest: null,
    }
    await db.activeWorkout.put({ slot: ownerId, ownerId, workout })
    await db.outbox.delete(id)
  })
}

export type SendResult = 'sent' | 'retry-later' | 'rejected'

export interface SyncReport {
  sent: number
  rejected: number
  pending: number
}

/** Kako postupiti sa greškom slanja. */
export function classifySendError(error: unknown): { result: Exclude<SendResult, 'sent'>; message: string | null } {
  if (axios.isAxiosError(error) && error.response) {
    const status = error.response.status
    // 4xx: server je pogledao podatke i odbio ih; ponovno slanje istog neće pomoći.
    // 401/403/408/429 su privremeni (prijava, istek vremena, previše zahteva).
    // A device clock ahead of the server can make started_at "future".
    // Keep the workout retryable instead of permanently hiding its saved sets.
    if (status === 400 && error.response.data && typeof error.response.data === 'object'
      && 'started_at' in error.response.data) {
      return { result: 'retry-later', message: null }
    }
    if (status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)) {
      const data = error.response.data as Record<string, unknown> | undefined
      const first = data && typeof data === 'object' ? Object.values(data)[0] : null
      const message = Array.isArray(first) ? String(first[0]) : typeof first === 'string' ? first : `HTTP ${status}`
      return { result: 'rejected', message }
    }
  }
  // Nema mreže, server nedostupan (5xx) ili nešto neočekivano: pokušaj kasnije.
  return { result: 'retry-later', message: null }
}

const running = new Map<string, Promise<SyncReport>>()

/**
 * Serialises work for one owner/session only. A different user cannot inherit a
 * previous user's in-flight promise. All IndexedDB writes are guarded when auth
 * changes while an HTTP response is still outstanding.
 */
export function syncOutbox(
  ownerId: string,
  send: (payload: SessionPayload) => Promise<unknown>,
  isCurrent: () => boolean = () => true,
  sessionKey = '',
): Promise<SyncReport> {
  const key = `${ownerId}:${sessionKey}`
  const existing = running.get(key)
  if (existing) return existing
  const task = (async () => {
    const report: SyncReport = { sent: 0, rejected: 0, pending: 0 }
    const rows = (await pendingSessions(ownerId)).filter((r) => !r.error).reverse()
    for (const row of rows) {
      if (!isCurrent()) break
      // Rows may have been discarded while this sync was waiting for IndexedDB.
      if (!(await db.outbox.get(row.id))) continue
      if (!isCurrent()) break
      try {
        await send(prepareSessionPayload(row.payload))
        if (!isCurrent()) break
        await db.outbox.delete(row.id)
        report.sent += 1
      } catch (error) {
        if (!isCurrent()) break
        const { result, message } = classifySendError(error)
        if (result === 'rejected') {
          await db.outbox.update(row.id, { error: message, attempts: row.attempts + 1 })
          report.rejected += 1
          continue
        }
        await db.outbox.update(row.id, { attempts: row.attempts + 1 })
        break
      }
    }
    report.pending = (await pendingSessions(ownerId)).filter((r) => !r.error).length
    return report
  })()
  const tracked = task.finally(() => { if (running.get(key) === tracked) running.delete(key) })
  running.set(key, tracked)
  return tracked
}

/**
 * Prošli rezultati iz treninga koji još nisu poslati. Bez ovoga bi "Prošli put" posle
 * treninga bez interneta pokazivao stariji trening sa servera.
 */
export function previousFromOutbox(rows: OutboxRow[], exerciseIds: string[]): Record<string, PreviousPerformance> {
  const result: Record<string, PreviousPerformance> = {}
  for (const row of [...rows].sort((a, b) => b.payload.started_at.localeCompare(a.payload.started_at))) {
    for (const item of row.payload.exercises) {
      if (!exerciseIds.includes(item.exercise_id) || result[item.exercise_id] || !item.sets.length) continue
      result[item.exercise_id] = { session_id: row.id, started_at: row.payload.started_at, sets: item.sets }
    }
  }
  return result
}

/** Spaja prošle rezultate sa servera i sa telefona: za svaku vežbu važi noviji trening. */
export function mergePrevious(
  server: Record<string, PreviousPerformance>,
  local: Record<string, PreviousPerformance>,
): Record<string, PreviousPerformance> {
  const merged = { ...server }
  for (const [id, perf] of Object.entries(local)) {
    if (!merged[id] || perf.started_at > merged[id].started_at) merged[id] = perf
  }
  return merged
}

/** Neposlati treninzi prijavljenog korisnika, uživo (osvežava se kad se red promeni). */
export function usePendingSessions(ownerId: string | undefined): OutboxRow[] | undefined {
  return useLiveQuery(async () => (ownerId ? pendingSessions(ownerId) : []), [ownerId])
}
