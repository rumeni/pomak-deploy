import type { OutboxRow } from '../../lib/db'
import type { Exercise } from '../training/api'
import type { WorkoutSession } from './api'
import type { LoggedSet } from './model'
import { hasReadiness, type Readiness } from './rpe'

export type SessionStatus = 'sent' | 'pending' | 'rejected' | 'deleting'

/** Trening za prikaz u istoriji, bilo da je na serveru ili još čeka slanje. */
export interface SessionView {
  id: string
  name: string
  startedAt: string
  finishedAt: string
  feeling: number | null
  notes: string
  readiness: Readiness | null
  status: SessionStatus
  error: string | null
  exercises: { exercise: Exercise; notes: string; sets: LoggedSet[] }[]
}

export function fromServer(s: WorkoutSession): SessionView {
  return {
    id: s.id,
    name: s.name,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    feeling: s.feeling,
    notes: s.notes,
    readiness: hasReadiness(s.readiness) ? s.readiness : null,
    status: 'sent',
    error: null,
    exercises: s.exercises.map((e) => ({ exercise: e.exercise, notes: e.notes, sets: e.sets })),
  }
}

export function fromOutbox(row: OutboxRow): SessionView {
  const byId = new Map(row.exercises.map((e) => [e.id, e]))
  return {
    id: row.id,
    name: row.payload.name,
    startedAt: row.payload.started_at,
    finishedAt: row.payload.finished_at,
    feeling: row.payload.feeling,
    notes: row.payload.notes,
    readiness: hasReadiness(row.payload.readiness) ? row.payload.readiness : null,
    status: row.deleteRequested ? 'deleting' : row.error ? 'rejected' : 'pending',
    error: row.error,
    // Kao na serveru: vežba bez potvrđenih serija nije deo odrađenog treninga.
    exercises: row.payload.exercises
      .filter((e) => e.sets.length && byId.has(e.exercise_id))
      .map((e) => ({ exercise: byId.get(e.exercise_id)!, notes: e.notes, sets: e.sets })),
  }
}

/** Istorija: neposlati i poslati zajedno, najnoviji prvi. Poslat trening se ne ponavlja. */
export function combineHistory(server: SessionView[], local: SessionView[]): SessionView[] {
  // Even if a server page is refetched while new workouts are inserted, each
  // session ID must appear once. Sent records supersede local pending copies.
  // A durable deletion tombstone must win over a cached server page until
  // DELETE is acknowledged. Pending uploads still yield to the server.
  const deleting = new Map(local.filter((s) => s.status === 'deleting').map((s) => [s.id, s]))
  const sent = new Map(server.map((s) => [s.id, deleting.get(s.id) ?? s]))
  return [...local.filter((l) => !sent.has(l.id)), ...sent.values()]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

/** Repeated exercises are legal in a finished workout; their list identity is positional. */
export function sessionExerciseKey(exerciseId: string, position: number): string {
  return `${exerciseId}:${position}`
}

export function durationSeconds(s: SessionView): number {
  return Math.max(0, Math.round((new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()) / 1000))
}

/** Trajanje treninga za prikaz: "< 1 min", "7 min", "1 h 5 min". */
export function formatWorkoutDuration(seconds: number, t: (key: string, o?: Record<string, unknown>) => string): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return t('history.underMinute')
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return t('history.minutes', { m })
  return m ? t('history.hoursMinutes', { h, m }) : t('history.hours', { h })
}

export function setCount(s: SessionView): number {
  return s.exercises.reduce((n, e) => n + e.sets.length, 0)
}
