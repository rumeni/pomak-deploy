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
 * Creates a prepared batch of routines one by one. Retrying the SAME batch after a network
 * error or a lost response is safe: each routine keeps its ID, and the server answers a
 * repeated create of an existing ID without making a second copy.
 */
export async function createRoutines(batch: RoutinePayload[], post: (body: RoutinePayload) => Promise<unknown>): Promise<void> {
  for (const body of batch) await post(body)
}


/** Keep an unfinished import's UUIDs across unmount/reopen and network retries. */
const pendingPrefix = 'pomak.pendingProgram.'
const pendingKey = (ownerId: string, programKey: string) => `${pendingPrefix}${ownerId}.${programKey}`

export function loadPendingProgram(ownerId: string, program: Program): RoutinePayload[] | null {
  try {
    const raw = localStorage.getItem(pendingKey(ownerId, program.key))
    if (!raw) return null
    const saved: unknown = JSON.parse(raw)
    const validId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
    if (Array.isArray(saved) && saved.length === program.routines.length && saved.every((item) =>
      item && typeof item === 'object' && typeof item.id === 'string' &&
      validId.test(item.id) && Array.isArray(item.exercises))) {
      return saved as RoutinePayload[]
    }
  } catch { /* storage disabled or unreadable: fall back to a fresh batch */ }
  return null
}

export function savePendingProgram(ownerId: string, programKey: string, batch: RoutinePayload[]): void {
  try { localStorage.setItem(pendingKey(ownerId, programKey), JSON.stringify(batch)) } catch { /* in-memory retry still works */ }
}

export function clearPendingProgram(ownerId: string, programKey: string): void {
  try { localStorage.removeItem(pendingKey(ownerId, programKey)) } catch { /* storage unavailable */ }
}
