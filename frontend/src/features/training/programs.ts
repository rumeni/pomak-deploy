import type { RoutineExercise, RoutinePayload } from './api'

export type ProgramLevel = 'beginner' | 'intermediate' | 'advanced'

/** A suggested program: routines in the same shape as the athlete's own (exercise objects included). */
export interface Program {
  key: string
  sex: 'male' | 'female'
  level: ProgramLevel
  days: number
  name: string
  description: string
  recommended: boolean
  routines: { name: string; exercises: RoutineExercise[] }[]
}

/** Request bodies that copy a program's routines into the athlete's own (new IDs, editable later). */
export function programToRoutines(program: Program, newId: () => string): RoutinePayload[] {
  return program.routines.map((routine) => ({
    id: newId(),
    name: routine.name,
    notes: program.name,
    exercises: routine.exercises.map((item) => ({
      exercise_id: item.exercise.id,
      rest_seconds: item.rest_seconds,
      notes: item.notes,
      sets: item.sets.map((s) => ({ ...s })),
    })),
  }))
}

/** "3 × 8–10 @ 6,5" for the program preview. */
export function describePrescription(item: RoutineExercise, secondsUnit: string): string {
  const s = item.sets[0]
  if (!s) return ''
  const count = item.sets.length
  const amount = s.duration_seconds !== null
    ? `${s.duration_seconds} ${secondsUnit}`
    : s.reps_min === s.reps_max ? String(s.reps_min) : `${s.reps_min}–${s.reps_max}`
  const rpe = s.rpe ? ` @ ${String(Number(s.rpe)).replace('.', ',')}` : ''
  return `${count} × ${amount}${rpe}`
}

/**
 * Creates a prepared batch of routines one by one. Retrying the SAME batch is safe: each
 * routine keeps its ID, and the server answers a repeated create of an existing ID without
 * making a second copy. Prefer `importProgram`, which also never overwrites edited routines.
 */
export async function createRoutines(batch: RoutinePayload[], post: (body: RoutinePayload) => Promise<unknown>): Promise<void> {
  for (const body of batch) await post(body)
}

/** An unfinished import: its routines (with IDs) and the ones known to exist already. */
export interface PendingProgram {
  batch: RoutinePayload[]
  done: string[]
}

export class ProgramImportAuthChanged extends Error {
  constructor() {
    super('PROGRAM_IMPORT_AUTH_CHANGED')
  }
}

export interface ImportDeps {
  /** Whether the account and login session that started the import are still the current ones. */
  isCurrent: () => boolean
  /** Does a routine with this ID already exist for the user? */
  exists: (id: string) => Promise<boolean>
  create: (body: RoutinePayload) => Promise<unknown>
}

/**
 * Copies a program's routines into the user's own, resumably and without ever overwriting.
 *
 * - Progress is stored after every routine, so a retry (also after leaving the screen or a
 *   reload) continues with the same IDs instead of duplicating.
 * - On a resumed import a routine that already exists (created before a lost response) is left
 *   exactly as it is: the user may have edited it since, and a repeated create would replace it.
 * - Every step runs only while the account and session that started it are current; if the
 *   login changes, the import stops and its record stays with the original account.
 * - Success removes the record here, not in the screen, so leaving mid-import cannot leave a
 *   stale record behind.
 */
export async function importProgram(ownerId: string, programKey: string, record: PendingProgram, deps: ImportDeps): Promise<void> {
  const resumed = record.done.length > 0 || loadPendingRecord(ownerId, programKey) !== null
  const done = new Set(record.done)
  savePendingRecord(ownerId, programKey, { batch: record.batch, done: [...done] })
  for (const body of record.batch) {
    const id = body.id!
    if (done.has(id)) continue
    if (!deps.isCurrent()) throw new ProgramImportAuthChanged()
    if (!(resumed && await deps.exists(id))) {
      if (!deps.isCurrent()) throw new ProgramImportAuthChanged()
      await deps.create(body)
    }
    done.add(id)
    savePendingRecord(ownerId, programKey, { batch: record.batch, done: [...done] })
  }
  clearPendingProgram(ownerId, programKey)
}

/** Keep an unfinished import's UUIDs and progress across unmount/reopen and network retries. */
export const PENDING_PROGRAM_PREFIX = 'pomak.pendingProgram.'
const pendingKey = (ownerId: string, programKey: string) => `${PENDING_PROGRAM_PREFIX}${ownerId}.${programKey}`
const validId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

function loadPendingRecord(ownerId: string, programKey: string): PendingProgram | null {
  try {
    const raw = localStorage.getItem(pendingKey(ownerId, programKey))
    if (!raw) return null
    const saved: unknown = JSON.parse(raw)
    // Older records were just the batch.
    const record = Array.isArray(saved) ? { batch: saved, done: [] } : saved as PendingProgram
    if (Array.isArray(record?.batch) && Array.isArray(record.done) && record.batch.every((item) =>
      item && typeof item === 'object' && typeof item.id === 'string' && validId.test(item.id) && Array.isArray(item.exercises))) {
      return { batch: record.batch, done: record.done.filter((id) => typeof id === 'string') }
    }
  } catch { /* storage disabled or unreadable: fall back to a fresh batch */ }
  return null
}

function savePendingRecord(ownerId: string, programKey: string, record: PendingProgram): void {
  try { localStorage.setItem(pendingKey(ownerId, programKey), JSON.stringify(record)) } catch { /* in-memory retry still works */ }
}

export function loadPendingProgram(ownerId: string, program: Program): PendingProgram | null {
  const record = loadPendingRecord(ownerId, program.key)
  return record && record.batch.length === program.routines.length ? record : null
}

export function clearPendingProgram(ownerId: string, programKey: string): void {
  try { localStorage.removeItem(pendingKey(ownerId, programKey)) } catch { /* storage unavailable */ }
}

/** Removes every unfinished import of a user (logout, account deletion). */
export function clearUserPendingPrograms(ownerId: string): void {
  const prefix = `${PENDING_PROGRAM_PREFIX}${ownerId}.`
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}
