import { formatDecimal, parseDecimal } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import type { Exercise, Routine, SetType } from '../training/api'
import { formatDuration } from '../training/labels'

/** Rezultat jedne serije sa servera (prošli put). */
export interface LoggedSet {
  set_type: SetType
  weight_kg: string | null
  reps: number | null
  duration_seconds: number | null
  distance_m: number | null
}

export interface PreviousPerformance {
  session_id: string
  started_at: string
  sets: LoggedSet[]
}

/** Serija tokom treninga. Polja su tekst kako ih je korisnik ukucao; `done` znači potvrđeno. */
export interface ActiveSet {
  key: string
  set_type: SetType
  weight: string
  reps: string
  duration: string
  distance: string
  target: { reps_min: number | null; reps_max: number | null; weight_kg: string | null } | null
  done: boolean
  completedAt: string | null
}

export interface ActiveExercise {
  key: string
  exercise: Exercise
  restSeconds: number
  notes: string
  sets: ActiveSet[]
}

export interface ActiveWorkout {
  id: string
  routineId: string | null
  name: string
  startedAt: string
  planSnapshot: Routine | null
  exercises: ActiveExercise[]
  previous: Record<string, PreviousPerformance>
  rest: { endsAt: string; totalSeconds: number } | null
}

/** Šta treba da se unese da bi serija bila potvrđena; ključ prevoda za grešku. */
export class SetInputError extends Error {}

export function startFromRoutine(routine: Routine, previous: Record<string, PreviousPerformance>, now: Date): ActiveWorkout {
  return {
    id: uuid(),
    routineId: routine.id,
    name: routine.name,
    startedAt: now.toISOString(),
    planSnapshot: routine,
    previous,
    rest: null,
    exercises: routine.exercises.map((e) => ({
      key: uuid(),
      exercise: e.exercise,
      restSeconds: e.rest_seconds ?? 0,
      notes: e.notes,
      sets: e.sets.map((s) => ({
        ...emptyActiveSet(s.set_type),
        target: { reps_min: s.reps_min, reps_max: s.reps_max, weight_kg: s.weight_kg },
      })),
    })),
  }
}

export function startEmpty(name: string, now: Date): ActiveWorkout {
  return { id: uuid(), routineId: null, name, startedAt: now.toISOString(), planSnapshot: null, previous: {}, rest: null, exercises: [] }
}

export function emptyActiveSet(set_type: SetType = 'working'): ActiveSet {
  return { key: uuid(), set_type, weight: '', reps: '', duration: '', distance: '', target: null, done: false, completedAt: null }
}

export function newActiveExercise(exercise: Exercise): ActiveExercise {
  const isCardio = exercise.measurement === 'duration' || exercise.measurement === 'distance_duration'
  return {
    key: uuid(),
    exercise,
    restSeconds: isCardio ? 0 : 90,
    notes: '',
    sets: isCardio ? [emptyActiveSet()] : [emptyActiveSet(), emptyActiveSet(), emptyActiveSet()],
  }
}

/**
 * Prošli rezultat za seriju: uparuje se po vrsti serije, pa 1. radna serija dobija 1. radnu
 * seriju prošlog puta, a zagrevanje zagrevanje (i kad je prošli put bilo drugačije zagrevanja).
 */
export function previousSet(workout: ActiveWorkout, item: ActiveExercise, index: number): LoggedSet | null {
  const set = item.sets[index]
  const previous = workout.previous[item.exercise.id]?.sets
  if (!set || !previous) return null
  const nth = item.sets.slice(0, index).filter((s) => s.set_type === set.set_type).length
  return previous.filter((s) => s.set_type === set.set_type)[nth] ?? null
}

/**
 * Ponuđena vrednost za prazno polje: prošli rezultat, pa plan iz rutine.
 * Prikazuje se sivo i postaje rezultat tek kad korisnik potvrdi seriju.
 */
export function suggestion(workout: ActiveWorkout, item: ActiveExercise, index: number): Omit<ActiveSet, 'key' | 'set_type' | 'target' | 'done' | 'completedAt'> {
  const prev = previousSet(workout, item, index)
  const target = item.sets[index]?.target
  const weight = prev?.weight_kg ?? target?.weight_kg ?? null
  const reps = prev?.reps ?? target?.reps_max ?? target?.reps_min ?? null
  return {
    weight: weight === null ? '' : formatDecimal(Number(weight)),
    reps: reps === null ? '' : String(reps),
    duration: prev?.duration_seconds ? formatDuration(prev.duration_seconds) : '',
    distance: prev?.distance_m ? formatDecimal(prev.distance_m / 1000) : '',
  }
}

/** "60 × 10", "12 pon.", "2,5 km · 15:00" — prošli rezultat za kolonu PROŠLI PUT. */
export function describeLogged(set: LoggedSet | null, exercise: Exercise, repsUnit: string): string {
  if (!set) return '–'
  const w = set.weight_kg === null ? null : formatDecimal(Number(set.weight_kg))
  switch (exercise.measurement) {
    case 'weight_reps':
    case 'weighted_bodyweight':
    case 'assisted_bodyweight':
      return w !== null && set.reps !== null ? `${w} × ${set.reps}` : set.reps !== null ? `${set.reps} ${repsUnit}` : '–'
    case 'bodyweight_reps':
      return set.reps !== null ? `${set.reps} ${repsUnit}` : '–'
    case 'duration':
      return set.duration_seconds ? formatDuration(set.duration_seconds) : '–'
    case 'distance_duration': {
      const km = set.distance_m ? `${formatDecimal(set.distance_m / 1000)} km` : ''
      const time = set.duration_seconds ? formatDuration(set.duration_seconds) : ''
      return [km, time].filter(Boolean).join(' · ') || '–'
    }
  }
}

function parseReps(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (!/^\d{1,4}$/.test(t)) throw new SetInputError('workout.errors.invalidReps')
  const value = Number(t)
  if (value > 1000) throw new SetInputError('workout.errors.invalidReps')
  return value
}

function parseWeight(text: string): number | null {
  if (!text.trim()) return null
  const value = parseDecimal(text)
  if (value === null || value > 1000 || !/^\d+(?:[.,]\d{1,2})?$/.test(text.trim())) {
    throw new SetInputError('workout.errors.invalidWeight')
  }
  return value
}

function parseDistance(text: string): number | null {
  if (!text.trim()) return null
  const km = parseDecimal(text)
  if (km === null || km < 0 || km > 500 || !/^\d+(?:[.,]\d{1,3})?$/.test(text.trim())) {
    throw new SetInputError('workout.errors.invalidWeight')
  }
  const metres = Math.round(km * 1000)
  if (metres < 1) throw new SetInputError('workout.errors.invalidWeight')
  return metres
}

function parseSeconds(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) throw new SetInputError('workout.errors.invalidDuration')
  const seconds = t.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  if (seconds <= 0 || seconds > 24 * 3600) throw new SetInputError('workout.errors.invalidDuration')
  return seconds
}

/** Vrednosti potvrđene serije u obliku za server; baca SetInputError ako nešto nedostaje. */
export function setResult(set: ActiveSet, exercise: Exercise): LoggedSet {
  const m = exercise.measurement
  const result: LoggedSet = { set_type: set.set_type, weight_kg: null, reps: null, duration_seconds: null, distance_m: null }
  if (m === 'duration' || m === 'distance_duration') {
    result.duration_seconds = parseSeconds(set.duration)
    if (m === 'distance_duration') {
      result.distance_m = parseDistance(set.distance)
    }
    if (result.duration_seconds === null && result.distance_m === null) throw new SetInputError('workout.errors.needDuration')
    return result
  }
  result.reps = parseReps(set.reps)
  if (result.reps === null) throw new SetInputError('workout.errors.needReps')
  if (m !== 'bodyweight_reps') {
    const weight = parseWeight(set.weight)
    if (weight === null && m === 'weight_reps') throw new SetInputError('workout.errors.needWeight')
    result.weight_kg = weight === null ? null : String(weight)
  }
  return result
}

/**
 * Potvrđuje seriju. Prazna polja dobijaju ponuđenu vrednost (prošli put / plan): pritisak
 * na ✓ je izričita potvrda baš tih brojeva. Vraća novi trening i pauzu koja počinje.
 */
export function confirmSet(workout: ActiveWorkout, exerciseKey: string, setKey: string, now: Date): ActiveWorkout {
  const item = workout.exercises.find((e) => e.key === exerciseKey)
  const index = item?.sets.findIndex((s) => s.key === setKey) ?? -1
  if (!item || index < 0) return workout
  const suggested = suggestion(workout, item, index)
  const current = item.sets[index]
  const filled: ActiveSet = {
    ...current,
    weight: current.weight || suggested.weight,
    reps: current.reps || suggested.reps,
    duration: current.duration || suggested.duration,
    distance: current.distance || suggested.distance,
  }
  setResult(filled, item.exercise) // baca grešku ako vrednosti nisu ispravne
  const confirmed = { ...filled, done: true, completedAt: now.toISOString() }
  return {
    ...workout,
    exercises: workout.exercises.map((e) =>
      e.key === exerciseKey ? { ...e, sets: e.sets.map((s) => (s.key === setKey ? confirmed : s)) } : e,
    ),
    rest: item.restSeconds > 0 ? { endsAt: new Date(now.getTime() + item.restSeconds * 1000).toISOString(), totalSeconds: item.restSeconds } : workout.rest,
  }
}

/** Vraća potvrđenu seriju u nepotvrđenu; upisane vrednosti ostaju za ispravku. */
export function unconfirmSet(workout: ActiveWorkout, exerciseKey: string, setKey: string): ActiveWorkout {
  return updateSet(workout, exerciseKey, setKey, { done: false, completedAt: null })
}

export function updateSet(workout: ActiveWorkout, exerciseKey: string, setKey: string, patch: Partial<ActiveSet>): ActiveWorkout {
  return {
    ...workout,
    exercises: workout.exercises.map((e) =>
      e.key === exerciseKey ? { ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) } : e,
    ),
  }
}

export interface WorkoutSummary {
  durationSeconds: number
  doneSets: number
  exercisesWithSets: number
  volumeKg: number
}

/** Sažetak za kraj treninga. Obim (kg × ponavljanja) računa samo radne serije sa težinom. */
export function summarize(workout: ActiveWorkout, now: Date): WorkoutSummary {
  let doneSets = 0
  let volumeKg = 0
  let exercisesWithSets = 0
  for (const item of workout.exercises) {
    const done = item.sets.filter((s) => s.done)
    if (done.length) exercisesWithSets += 1
    doneSets += done.length
    if (item.exercise.measurement !== 'weight_reps') continue
    const perSide = item.exercise.load_mode === 'per_side' ? 2 : 1
    for (const s of done) {
      if (s.set_type !== 'working') continue
      const r = setResult(s, item.exercise)
      volumeKg += Number(r.weight_kg ?? 0) * (r.reps ?? 0) * perSide
    }
  }
  const durationSeconds = Math.max(0, Math.round((now.getTime() - new Date(workout.startedAt).getTime()) / 1000))
  return { durationSeconds, doneSets, exercisesWithSets, volumeKg: Math.round(volumeKg) }
}

/**
 * A workout may remain open overnight after the last confirmed set. Use that
 * set's timestamp rather than the moment the user reopened "Finish".
 * Bound duration to the API's 24-hour maximum so a stale session cannot
 * be permanently rejected after being moved into the offline outbox.
 */
export function finishTimeForWorkout(workout: ActiveWorkout, openedAt: Date): Date {
  const start = new Date(workout.startedAt).getTime()
  const opened = openedAt.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(opened)) return openedAt
  const maxEnd = start + 24 * 3600 * 1000
  if (opened <= maxEnd) return new Date(Math.max(start, opened))
  const completed = workout.exercises.flatMap((e) => e.sets)
    .filter((s) => s.done && s.completedAt)
    .map((s) => new Date(s.completedAt!).getTime())
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= start && timestamp <= opened)
  const end = completed.length ? Math.max(...completed) : opened
  return new Date(Math.max(start, Math.min(end, maxEnd)))
}

export interface SessionPayload {
  id: string
  routine_id: string | null
  name: string
  started_at: string
  finished_at: string
  plan_snapshot: Routine | null
  feeling: number | null
  notes: string
  exercises: { exercise_id: string; notes: string; sets: (LoggedSet & { completed_at: string | null })[] }[]
}

/** Telo zahteva za server: samo potvrđene serije. */
export function toSessionPayload(workout: ActiveWorkout, finishedAt: Date, feeling: number | null, notes: string): SessionPayload {
  return {
    id: workout.id,
    routine_id: workout.routineId,
    name: workout.name,
    started_at: workout.startedAt,
    finished_at: finishedAt.toISOString(),
    plan_snapshot: workout.planSnapshot,
    feeling,
    notes,
    exercises: workout.exercises.map((item) => ({
      exercise_id: item.exercise.id,
      notes: item.notes,
      sets: item.sets.filter((s) => s.done).map((s) => ({ ...setResult(s, item.exercise), completed_at: s.completedAt })),
    })),
  }
}
