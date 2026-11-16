import axios from 'axios'
import { useLiveQuery } from 'dexie-react-hooks'

import { db, type OutboxRow } from '../../lib/db'
import { getCurrentUserId } from '../../lib/currentUser'
import { StaleWorkoutError } from './store'
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
  expectedRevision?: number,
): Promise<void> {
  if (getCurrentUserId() !== ownerId) throw new StaleWorkoutError()
  await db.transaction('rw', db.outbox, db.activeWorkout, async () => {
    const active = await db.activeWorkout.get(ownerId)
    // Check and delete atomically with the outbox insertion; another tab
    // may have replaced workout A with B after this screen loaded.
    if (getCurrentUserId() !== ownerId ||
        active?.ownerId !== ownerId || active.workout.id !== payload.id ||
        (expectedRevision !== undefined && (active.revision ?? 0) !== expectedRevision)) {
      throw new StaleWorkoutError()
    }
    await db.outbox.put({ id: payload.id, ownerId, payload, exercises, queuedAt: now.toISOString(), attempts: 0, error: null })
    await db.activeWorkout.delete(ownerId)
  })
}

export async function pendingSessions(ownerId: string): Promise<OutboxRow[]> {
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray()
  return rows.sort((a, b) => b.payload.started_at.localeCompare(a.payload.started_at))
}

/**
 * A pending POST may have committed even if its HTTP response was lost.
 * Never simply delete a row once an upload was attempted: keep a minimal,
 * owner-scoped tombstone and retry DELETE until the server confirms removal.
 * An in-flight POST and this operation are serialized through IndexedDB.
 */
export async function discardOutboxItem(ownerId: string, id: string): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.get(id)
    if (row && row.ownerId !== ownerId) throw new Error('NOT_FOUND')
    if (row && row.attempts === 0 && !row.sendingAt && !row.deleteRequested) {
      await db.outbox.delete(id)
      return
    }
    const time = new Date().toISOString()
    // Keep only its identity: cancellation must not keep deleted workout data.
    const tombstone: OutboxRow = {
      id, ownerId, attempts: row?.attempts ?? 1, error: null,
      deleteRequested: true, sendingAt: row?.sendingAt ?? null,
      deletingAt: row?.deletingAt ?? null, queuedAt: row?.queuedAt ?? time,
      payload: {
        id, routine_id: null, name: '', started_at: row?.payload.started_at ?? time,
        finished_at: time, plan_snapshot: null, feeling: null,
        notes: '', exercises: [],
      },
      exercises: [],
    }
    await db.outbox.put(tombstone)
  })
}

/**
 * Reconstruct a rejected session as a fully editable active workout. The original
 * outbox row is removed only after the draft is durably stored in one transaction.
 */
export async function restoreRejectedWorkout(ownerId: string, id: string): Promise<void> {
  await db.transaction('rw', db.outbox, db.activeWorkout, async () => {
    const row = await db.outbox.get(id)
    if (!row || row.ownerId !== ownerId || !row.error || row.deleteRequested) throw new Error('NOT_FOUND')
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
  deleted?: number
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
// Expire stale cross-tab claims after a terminated WebView/browser, longer
// than the API's 15s request timeout. The cancel flag itself never expires.
const CLAIM_TTL_MS = 60_000

function claimLive(time: number | null | undefined): boolean {
  return typeof time === 'number' && time > Date.now() - CLAIM_TTL_MS
}

export function syncOutbox(
  ownerId: string,
  send: (payload: SessionPayload) => Promise<unknown>,
  isCurrent: () => boolean = () => true,
  sessionKey = '',
  remove?: (id: string) => Promise<unknown>,
): Promise<SyncReport> {
  const key = `${ownerId}:${sessionKey}`
  const existing = running.get(key)
  if (existing) return existing
  const task = (async () => {
    const report: SyncReport = { sent: 0, rejected: 0, pending: 0 }

    const removeIfRequested = async (id: string): Promise<boolean> => {
      if (!remove || !isCurrent()) return false
      const claim = await db.transaction('rw', db.outbox, async () => {
        const row = await db.outbox.get(id)
        if (!row || row.ownerId !== ownerId || !row.deleteRequested ||
            claimLive(row.sendingAt) || claimLive(row.deletingAt) || !isCurrent()) return null
        const stamp = Date.now()
        await db.outbox.update(id, { deletingAt: stamp })
        return stamp
      })
      if (claim === null) return false
      let confirmed = false
      try {
        await remove(id)
        confirmed = true
      } catch (error) {
        // DELETE of a never-committed or already-deleted upload is idempotent.
        if (axios.isAxiosError(error) && error.response?.status === 404) confirmed = true
      }
      await db.transaction('rw', db.outbox, async () => {
        const row = await db.outbox.get(id)
        if (!row || row.ownerId !== ownerId || row.deletingAt !== claim) return
        if (confirmed && isCurrent()) await db.outbox.delete(id)
        else await db.outbox.update(id, { deletingAt: null })
      })
      if (confirmed && isCurrent()) {
        report.deleted = (report.deleted ?? 0) + 1
        return true
      }
      return false
    }

    // Cancellation rows are included even though normal rejected uploads are not.
    const rows = (await db.outbox.where('ownerId').equals(ownerId).toArray())
      .filter((r) => !r.error || r.deleteRequested)
      .sort((a, b) => a.payload.started_at.localeCompare(b.payload.started_at))
    for (const row of rows) {
      if (!isCurrent()) break
      const latest = await db.outbox.get(row.id)
      if (!latest || latest.ownerId !== ownerId) continue
      if (latest.deleteRequested) {
        if (!await removeIfRequested(row.id)) break
        continue
      }
      const claim = await db.transaction('rw', db.outbox, async () => {
        const current = await db.outbox.get(row.id)
        if (!current || current.ownerId !== ownerId || current.error ||
          current.deleteRequested || claimLive(current.sendingAt) ||
          claimLive(current.deletingAt) || !isCurrent()) return null
        const stamp = Date.now()
        // Count attempt before HTTP: if the process closes after a commit,
        // deletion must still contact the server on next launch.
        await db.outbox.update(row.id, { sendingAt: stamp, attempts: current.attempts + 1 })
        return stamp
      })
      if (claim === null) continue
      let sent = false
      let failure: unknown
      try {
        await send(prepareSessionPayload(row.payload))
        sent = true
      } catch (error) {
        failure = error
      }
      const outcome = await db.transaction('rw', db.outbox, async () => {
        const current = await db.outbox.get(row.id)
        if (!current || current.ownerId !== ownerId || current.sendingAt !== claim) return 'missing'
        if (!isCurrent()) {
          await db.outbox.update(row.id, { sendingAt: null })
          return 'stopped'
        }
        if (current.deleteRequested) {
          await db.outbox.update(row.id, { sendingAt: null })
          return 'delete'
        }
        if (sent) {
          await db.outbox.delete(row.id)
          return 'sent'
        }
        const { result, message } = classifySendError(failure)
        if (result === 'rejected') {
          await db.outbox.update(row.id, { sendingAt: null, error: message })
          return 'rejected'
        }
        await db.outbox.update(row.id, { sendingAt: null })
        return 'retry-later'
      })
      if (outcome === 'stopped') break
      if (outcome === 'sent') report.sent += 1
      if (outcome === 'rejected') report.rejected += 1
      if (outcome === 'retry-later') break
      if (outcome === 'delete' && !await removeIfRequested(row.id)) break
    }
    report.pending = (await db.outbox.where('ownerId').equals(ownerId).toArray())
      .filter((r) => !r.error && !r.deleteRequested).length
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
    if (row.deleteRequested) continue
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
