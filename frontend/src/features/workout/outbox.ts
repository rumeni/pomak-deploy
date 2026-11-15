import axios from 'axios'
import { useLiveQuery } from 'dexie-react-hooks'

import { db, type OutboxRow } from '../../lib/db'
import type { Exercise } from '../training/api'
import type { PreviousPerformance, SessionPayload } from './model'

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
    await db.activeWorkout.delete('current')
  })
}

export async function pendingSessions(ownerId: string): Promise<OutboxRow[]> {
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray()
  return rows.sort((a, b) => b.payload.started_at.localeCompare(a.payload.started_at))
}

export async function discardOutboxItem(id: string): Promise<void> {
  await db.outbox.delete(id)
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

let running: Promise<SyncReport> | null = null

/**
 * Šalje red za slanje za jednog korisnika, jedan po jedan, najstariji prvo.
 * Samo jedno slanje odjednom (ponovni poziv čeka isto). Zaustavlja se na prvoj
 * privremenoj grešci, da se ne troši baterija dok nema interneta.
 */
export function syncOutbox(ownerId: string, send: (payload: SessionPayload) => Promise<unknown>): Promise<SyncReport> {
  running ??= (async () => {
    const report: SyncReport = { sent: 0, rejected: 0, pending: 0 }
    const rows = (await pendingSessions(ownerId)).filter((r) => !r.error).reverse()
    for (const row of rows) {
      try {
        await send(row.payload)
        await db.outbox.delete(row.id)
        report.sent += 1
      } catch (error) {
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
  })().finally(() => {
    running = null
  })
  return running
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
