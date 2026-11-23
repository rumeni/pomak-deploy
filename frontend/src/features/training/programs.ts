import type { Routine, RoutineExercise, RoutinePayload } from './api'
import { bothSides } from './labels'

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
    program_key: program.key,
    exercises: routine.exercises.map((item) => ({
      exercise_id: item.exercise.id,
      rest_seconds: item.rest_seconds,
      notes: item.notes,
      sets: item.sets.map((s) => ({ ...s })),
    })),
  }))
}

/** First imports share deterministic UUIDs across browsers/devices. Two devices
 * importing before either sees the other's first row therefore hit the SAME
 * create-only primary key, not two different routines. Deliberate re-imports
 * after confirmation continue to use fresh random UUIDs.
 */
export async function firstImportRoutines(program: Program, ownerId: string): Promise<RoutinePayload[]> {
  const ids = await Promise.all(program.routines.map(async (_routine, index) => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`pomak:first-import:${ownerId}:${program.key}:${index}`),
    )
    const bytes = new Uint8Array(digest).slice(0, 16)
    bytes[6] = (bytes[6] & 0x0f) | 0x50
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }))
  let index = 0
  return programToRoutines(program, () => ids[index++])
}

/** Stable identity survives language switches and user edits; older imports use a name fallback. */
export function programAlreadyAdded(program: Program, routines: readonly Pick<Routine, 'name' | 'notes' | 'program_key'>[] | undefined): boolean {
  const names = new Set(program.routines.map((r) => r.name))
  return !!routines?.some((routine) =>
    routine.program_key === program.key
    || (!routine.program_key && names.has(routine.name) && routine.notes === program.name))
}

/**
 * Every routine of the program is there (a finished import), not just some of them: a first
 * import that stopped halfway on another device has no local record here. Counted by the stable
 * program key (names may be translated or edited); older imports by name.
 */
export function programCompletelyAdded(program: Program, routines: readonly Pick<Routine, 'name' | 'notes' | 'program_key'>[] | undefined): boolean {
  if (!routines?.length) return false
  // Distinct names, so two half-finished copies do not add up to one complete program.
  const keyed = new Set(routines.filter((routine) => routine.program_key === program.key).map((r) => r.name))
  if (keyed.size >= program.routines.length) return true
  const legacy = new Set(routines.filter((r) => !r.program_key && r.notes === program.name).map((r) => r.name))
  return program.routines.every((r) => legacy.has(r.name))
}

/** Serialise one program import across tabs on Chrome/Android secure origins.
 * The caller must re-read server routines AFTER taking the lock so a waiting
 * second tab can see what the first tab just imported.
 */
export async function withProgramImportLock<T>(ownerId: string, programKey: string, run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request(`pomak-import:${ownerId}:${programKey}`, run) : run()
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
  return `${count} × ${bothSides(amount, item.exercise)}${rpe}`
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
  /**
   * Create-only on the server (`?create_only=1`): makes the routine, or reports that the ID
   * already exists and leaves that routine exactly as it is (never an update).
   */
  create: (body: RoutinePayload) => Promise<'created' | 'exists'>
}

/** Bumped when an account's local data is cleared, so imports already in flight stop writing. */
const cleanupGeneration = new Map<string, number>()
const generationOf = (ownerId: string) => cleanupGeneration.get(ownerId) ?? 0

/** Imports in flight, one per account and program, shared by every screen that starts it. */
const running = new Map<string, Promise<void>>()

/** Whether this account is importing this program right now (e.g. started before leaving the screen). */
export function isImportingProgram(ownerId: string, programKey: string): boolean {
  return running.has(`${ownerId}:${programKey}`)
}

/**
 * Copies a program's routines into the user's own, resumably and without ever overwriting.
 *
 * - Progress is stored after every routine, so a retry (also after leaving the screen or a
 *   reload) continues with the same IDs instead of duplicating.
 * - Every routine is sent create-only: one that already exists (created before a lost response,
 *   or by the same import in another tab) is left exactly as it is on the server - the user may
 *   have edited it since. This holds across tabs and devices, not just in this one.
 * - Progress records are merged by batch identity, so two tabs never erase each other's progress.
 * - One import per account and program at a time: starting it again (e.g. after leaving and
 *   reopening the screen) joins the one in flight instead of running a second loop.
 * - Every step - including writing progress after a request returns - runs only while the
 *   account and session that started it are current and its local data has not been cleared
 *   (logout, account deletion); otherwise the import stops without writing anything.
 * - Success removes the record here, not in the screen, so leaving mid-import cannot leave a
 *   stale record behind.
 */
export function importProgram(ownerId: string, programKey: string, record: PendingProgram, deps: ImportDeps): Promise<void> {
  const key = `${ownerId}:${programKey}`
  const inFlight = running.get(key)
  if (inFlight) return inFlight
  const run = runImport(ownerId, programKey, record, deps).finally(() => running.delete(key))
  running.set(key, run)
  return run
}

async function runImport(ownerId: string, programKey: string, record: PendingProgram, deps: ImportDeps): Promise<void> {
  const generation = generationOf(ownerId)
  const valid = () => deps.isCurrent() && generationOf(ownerId) === generation
  const guard = () => {
    if (!valid()) throw new ProgramImportAuthChanged()
  }
  guard()
  const done = new Set(record.done)
  savePendingRecord(ownerId, programKey, { batch: record.batch, done: [...done] })
  for (const body of record.batch) {
    const id = body.id!
    if (done.has(id) || loadPendingRecord(ownerId, programKey)?.done.includes(id)) continue
    guard()
    await deps.create(body) // 'exists' is fine too: that routine is never touched
    guard() // the answer may arrive after a logout
    done.add(id)
    savePendingRecord(ownerId, programKey, { batch: record.batch, done: [...done] })
  }
  // Only this batch's record: another tab may have started a different one meanwhile.
  if (sameBatch(loadPendingRecord(ownerId, programKey)?.batch, record.batch)) clearPendingProgram(ownerId, programKey)
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

const batchIds = (batch: RoutinePayload[] | undefined) => (batch ?? []).map((b) => b.id).join(',')
function sameBatch(a: RoutinePayload[] | undefined, b: RoutinePayload[]): boolean {
  return batchIds(a) === batchIds(b)
}

/** Writes progress; for the same batch (another tab) the done lists are merged, never reduced. */
function savePendingRecord(ownerId: string, programKey: string, record: PendingProgram): void {
  const stored = loadPendingRecord(ownerId, programKey)
  const done = stored && sameBatch(stored.batch, record.batch) ? [...new Set([...stored.done, ...record.done])] : record.done
  try { localStorage.setItem(pendingKey(ownerId, programKey), JSON.stringify({ batch: record.batch, done })) } catch { /* in-memory retry still works */ }
}

export function loadPendingProgram(ownerId: string, program: Program): PendingProgram | null {
  const record = loadPendingRecord(ownerId, program.key)
  return record && record.batch.length === program.routines.length ? record : null
}

export function clearPendingProgram(ownerId: string, programKey: string): void {
  try { localStorage.removeItem(pendingKey(ownerId, programKey)) } catch { /* storage unavailable */ }
}

/** Removes every unfinished import of a user (logout, account deletion); imports in flight stop. */
export function clearUserPendingPrograms(ownerId: string): void {
  cleanupGeneration.set(ownerId, generationOf(ownerId) + 1)
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
