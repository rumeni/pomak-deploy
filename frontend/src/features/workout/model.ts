import { formatDecimal, parseDecimal } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import type { Exercise, Routine, SetType } from '../training/api'
import { formatDuration } from '../training/labels'
import { estimated1rm, formatRpe, hasReadiness, parseRpe, weightForTarget, type Readiness } from './rpe'

/** Rezultat jedne serije sa servera (prošli put). */
export interface LoggedSet {
  set_type: SetType
  weight_kg: string | null
  reps: number | null
  duration_seconds: number | null
  distance_m: number | null
  /** How hard the set felt; absent in sets logged before RPE existed. */
  rpe?: string | null
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
  /** Logged RPE; can be added or changed after the set is confirmed. */
  rpe?: number | null
  target: { reps_min: number | null; reps_max: number | null; weight_kg: string | null; rpe?: number | null } | null
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
  /** Preserved when a rejected outbox session is restored for editing. */
  draftFeeling?: number | null
  draftNotes?: string
  recoveredFinishedAt?: string
  /** Pre-workout check-in (sleep, stress, soreness ...); every answer optional. */
  readiness?: Readiness
  /** The check-in step was answered or skipped; the workout itself shows from then on. */
  checkInDone?: boolean
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
        target: { reps_min: s.reps_min, reps_max: s.reps_max, weight_kg: s.weight_kg, rpe: parseRpe(s.rpe) },
      })),
    })),
  }
}

export function startEmpty(name: string, now: Date): ActiveWorkout {
  return { id: uuid(), routineId: null, name, startedAt: now.toISOString(), planSnapshot: null, previous: {}, rest: null, exercises: [] }
}

export function emptyActiveSet(set_type: SetType = 'working'): ActiveSet {
  return { key: uuid(), set_type, weight: '', reps: '', duration: '', distance: '', rpe: null, target: null, done: false, completedAt: null }
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
 * The planned RPE that applies to a set right now. The plan targets working sets only, so a
 * set switched to a warm-up during the workout drops it (and its RPE-based load).
 */
export function targetRpe(set: ActiveSet | undefined): number | null {
  return set?.set_type === 'working' ? set.target?.rpe ?? null : null
}

/** Best estimated 1RM from last time's working sets (RPE-aware), or null. */
export function previousEstimated1rm(workout: ActiveWorkout, item: ActiveExercise): number | null {
  const sets = workout.previous[item.exercise.id]?.sets ?? []
  let best: number | null = null
  for (const s of sets) {
    if (s.set_type !== 'working' || s.weight_kg === null || s.reps === null) continue
    const e1rm = estimated1rm(Number(s.weight_kg), s.reps, parseRpe(s.rpe))
    if (e1rm !== null && (best === null || e1rm > best)) best = e1rm
  }
  return best
}

/**
 * Load for a set the routine prescribes by intensity (e.g. 5 @ RPE 8), worked out from last
 * time's estimated 1RM - what a coach does with an RPE chart.
 *
 * Returns null when RPE does not drive this set (no target RPE, a fixed weight in the plan,
 * or no history to estimate from). Otherwise `weight` is the load for the reps the athlete
 * typed, or the planned reps while the field is empty. When the chart has no value for those
 * reps (e.g. 12 @ 8), `weight` is null: the athlete must enter the weight, because last
 * time's load would not match the prescribed effort.
 */
export function rpeTargetWeight(workout: ActiveWorkout, item: ActiveExercise, index: number): { weight: number | null; reps: number } | null {
  const set = item.sets[index]
  const target = set?.target
  const planned = target?.reps_max ?? target?.reps_min ?? null
  const rpe = targetRpe(set)
  if (item.exercise.measurement !== 'weight_reps' || !target || rpe === null || planned === null || target.weight_kg !== null) return null
  const e1rm = previousEstimated1rm(workout, item)
  if (e1rm === null) return null
  const typed = /^\d{1,4}$/.test(set.reps.trim()) ? Number(set.reps.trim()) : null
  const reps = typed !== null && typed > 0 ? typed : planned
  return { weight: weightForTarget(e1rm, reps, rpe, item.exercise.load_mode === 'per_side' ? 1 : 2.5), reps }
}

/**
 * Ponuđena vrednost za prazno polje: prošli rezultat, pa plan iz rutine.
 * Prikazuje se sivo i postaje rezultat tek kad korisnik potvrdi seriju.
 * When the plan sets an RPE target (and no fixed weight), the weight comes from the RPE chart.
 */
export function suggestion(workout: ActiveWorkout, item: ActiveExercise, index: number): Pick<ActiveSet, 'weight' | 'reps' | 'duration' | 'distance'> {
  const prev = previousSet(workout, item, index)
  const target = item.sets[index]?.target
  const fromRpe = rpeTargetWeight(workout, item, index)
  // A prescription wins over last time's numbers when the load is derived from it.
  const weight = fromRpe ? fromRpe.weight : prev?.weight_kg ?? target?.weight_kg ?? null
  const reps = fromRpe ? fromRpe.reps : prev?.reps ?? target?.reps_max ?? target?.reps_min ?? null
  return {
    weight: weight === null ? '' : formatDecimal(Number(weight)),
    reps: reps === null ? '' : String(reps),
    duration: prev?.duration_seconds ? formatDuration(prev.duration_seconds) : '',
    distance: prev?.distance_m ? formatDecimal(prev.distance_m / 1000) : '',
  }
}

/** "60 × 10", "12 pon.", "2,5 km · 15:00" — prošli rezultat za kolonu PROŠLI PUT. With `withRpe`: "60 × 10 @ 8". */
export function describeLogged(set: LoggedSet | null, exercise: Exercise, repsUnit: string, withRpe = false): string {
  if (!set) return '–'
  const rpe = withRpe ? parseRpe(set.rpe) : null
  const text = describeValues(set, exercise, repsUnit)
  return rpe === null || text === '–' ? text : `${text} @ ${formatRpe(rpe)}`
}

function describeValues(set: LoggedSet, exercise: Exercise, repsUnit: string): string {
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

function parseWeight(text: string, confirmedLegacy = false): number | null {
  if (!text.trim()) return null
  const value = parseDecimal(text)
  const decimal = text.trim().match(/^\d+(?:[.,](\d+))?$/)
  const significantDigits = decimal?.[1]?.replace(/0+$/, '') ?? ''
  // Older versions permitted 60.000 on already-confirmed offline sets.
  // Accept only those values which roundtrip exactly at backend precision.
  const precisionValid = confirmedLegacy
    ? !!decimal && significantDigits.length <= 2
    : /^\d+(?:[.,]\d{1,2})?$/.test(text.trim())
  if (value === null || value > 1000 || !precisionValid) {
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
  const rpe = parseRpe(set.rpe ?? null)
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
  if (rpe !== null) result.rpe = String(rpe)
  if (m !== 'bodyweight_reps') {
    const weight = parseWeight(set.weight, set.done)
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
      // Old persisted workouts may contain a now-invalid number. Never crash
      // the finish screen; Save will report an actionable validation error.
      try {
        const r = setResult(s, item.exercise)
        volumeKg += Number(r.weight_kg ?? 0) * (r.reps ?? 0) * perSide
      } catch (error) {
        if (!(error instanceof SetInputError)) throw error
      }
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
  const completed = workout.exercises.flatMap((e) => e.sets)
    .filter((s) => s.done && s.completedAt)
    .map((s) => new Date(s.completedAt!).getTime())
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= start && timestamp <= opened)
  const savedEnd = workout.recoveredFinishedAt
    ? new Date(workout.recoveredFinishedAt).getTime() : Number.NaN
  if (Number.isFinite(savedEnd) && savedEnd >= start && savedEnd <= maxEnd) {
    const newlyConfirmed = completed.filter((timestamp) => timestamp > savedEnd)
    return new Date(newlyConfirmed.length ? Math.min(Math.max(...newlyConfirmed), maxEnd) : savedEnd)
  }
  if (opened <= maxEnd) return new Date(Math.max(start, opened))
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
  /** Omitted when the check-in was skipped (and by older app versions). */
  readiness?: Readiness
  exercises: { exercise_id: string; notes: string; sets: (LoggedSet & { completed_at: string | null })[] }[]
}

/**
 * API stores snapshots for the historical plan, not the workout's confirmed
 * results (those are separate SetLog rows). A valid routine can contain very
 * long notes/instructions. Keep the original snapshot while exercising, and
 * remove bulky presentation-only fields only if its upload would breach the
 * server's 256 KiB cap.
 *
 * The same converter is used for old, unsent workouts created before this fix.
 */
export const MAX_WORKOUT_SNAPSHOT_BYTES = 256 * 1024

function snapshotBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** Trim by Unicode code points, never in the middle of an emoji/surrogate pair. */
function unicodePrefix(text: string, limit: number): string {
  let prefix = ''
  for (const symbol of text) {
    if (limit-- <= 0) break
    const code = symbol.codePointAt(0) ?? 0
    prefix += code >= 0xD800 && code <= 0xDFFF ? String.fromCodePoint(0xFFFD) : symbol
  }
  return prefix
}

export function uploadSafePlanSnapshot(snapshot: Routine | null): Routine | null {
  if (snapshot === null || snapshotBytes(snapshot) <= MAX_WORKOUT_SNAPSHOT_BYTES) return snapshot

  // Preserve exercise identity, targets and ordering. Only human-readable,
  // unbounded text (instructions and routine notes) is abbreviated.
  const compact: Routine = {
    id: snapshot.id,
    name: unicodePrefix(snapshot.name, 100),
    notes: unicodePrefix(snapshot.notes, 8192),
    created_at: snapshot.created_at,
    updated_at: snapshot.updated_at,
    exercises: snapshot.exercises.slice(0, 40).map((item) => ({
      exercise: {
        id: item.exercise.id,
        slug: item.exercise.slug,
        name: unicodePrefix(item.exercise.name, 120),
        aliases: '',
        equipment: item.exercise.equipment,
        measurement: item.exercise.measurement,
        load_mode: item.exercise.load_mode,
        muscle: item.exercise.muscle,
        instructions: '',
        is_custom: item.exercise.is_custom,
      },
      rest_seconds: item.rest_seconds,
      notes: unicodePrefix(item.notes, 300),
      sets: item.sets.slice(0, 20).map((set) => ({
        set_type: set.set_type,
        reps_min: set.reps_min,
        reps_max: set.reps_max,
        weight_kg: set.weight_kg,
        duration_seconds: set.duration_seconds,
        distance_m: set.distance_m,
        rpe: set.rpe,
      })),
    })),
  }
  if (snapshotBytes(compact) <= MAX_WORKOUT_SNAPSHOT_BYTES) return compact
  // Defensive fallback for malformed legacy snapshots: logged sets and
  // exercise IDs still travel independently of this optional historical plan.
  return { ...compact, notes: '', exercises: compact.exercises.map((item) => ({
    ...item, notes: '', sets: item.sets,
  })) }
}

export function prepareSessionPayload(payload: SessionPayload): SessionPayload {
  const safe = uploadSafePlanSnapshot(payload.plan_snapshot)
  return safe === payload.plan_snapshot ? payload : { ...payload, plan_snapshot: safe }
}

/** Telo zahteva za server: samo potvrđene serije. */
export function toSessionPayload(workout: ActiveWorkout, finishedAt: Date, feeling: number | null, notes: string): SessionPayload {
  return prepareSessionPayload({
    id: workout.id,
    routine_id: workout.routineId,
    name: workout.name,
    started_at: workout.startedAt,
    finished_at: finishedAt.toISOString(),
    plan_snapshot: workout.planSnapshot,
    feeling,
    notes,
    ...(hasReadiness(workout.readiness) ? { readiness: workout.readiness } : {}),
    exercises: workout.exercises.map((item) => ({
      exercise_id: item.exercise.id,
      notes: item.notes,
      sets: item.sets.filter((s) => s.done).map((s) => ({ ...setResult(s, item.exercise), completed_at: s.completedAt })),
    })),
  })
}
