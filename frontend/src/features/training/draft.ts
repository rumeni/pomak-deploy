import { formatDecimal, parseDecimal } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import type { Exercise, Routine, RoutinePayload, RoutineSet, SetType } from './api'
import { formatDuration } from './labels'

/** Serija dok se uređuje: polja su tekst kako ih je korisnik ukucao ("8-10", "62,5", "1:30"). */
export interface DraftSet {
  key: string
  set_type: SetType
  reps: string
  weight: string
  duration: string
  distance: string
}

export interface DraftExercise {
  key: string
  exercise: Exercise
  rest_seconds: number | null
  notes: string
  sets: DraftSet[]
}

export interface RoutineDraft {
  id: string
  isNew: boolean
  name: string
  notes: string
  exercises: DraftExercise[]
}

/** Greška u nacrtu: ključ prevoda (routine.errors.*) i vrednosti za poruku. */
export class DraftError extends Error {
  readonly key: string
  readonly params: Record<string, string>

  constructor(key: string, params: Record<string, string> = {}) {
    super(key)
    this.key = key
    this.params = params
  }
}

/** "8" -> [8, 8], "8-10" -> [8, 10], "" -> [null, null] */
export function parseRepRange(text: string): [number | null, number | null] {
  const t = text.trim()
  if (!t) return [null, null]
  const m = /^(\d{1,3})\s*(?:[-–]\s*(\d{1,3}))?$/.exec(t)
  if (!m) throw new DraftError('invalidReps', { value: text })
  const low = Number(m[1])
  const high = m[2] ? Number(m[2]) : low
  if (low < 1 || high < low) throw new DraftError('invalidRepRange', { value: text })
  return [low, high]
}

/** "1:30" -> 90, "45" -> 45 sekundi, "1:02:05" -> 3725, "" -> null */
export function parseDuration(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) throw new DraftError('invalidDuration', { value: text })
  const seconds = t.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  if (seconds <= 0) throw new DraftError('zeroDuration')
  return seconds
}

function parseOptionalDecimal(text: string, exercise: string): number | null {
  if (!text.trim()) return null
  const value = parseDecimal(text)
  if (value === null) throw new DraftError('invalidNumber', { exercise, value: text })
  return value
}

export function emptySet(set_type: SetType = 'working'): DraftSet {
  return { key: uuid(), set_type, reps: '', weight: '', duration: '', distance: '' }
}

export function newDraftExercise(exercise: Exercise): DraftExercise {
  const isCardio = exercise.measurement === 'distance_duration' || exercise.measurement === 'duration'
  return {
    key: uuid(),
    exercise,
    rest_seconds: isCardio ? 0 : 90,
    notes: '',
    sets: isCardio ? [emptySet()] : [emptySet(), emptySet(), emptySet()],
  }
}

export function newRoutineDraft(): RoutineDraft {
  return { id: uuid(), isNew: true, name: '', notes: '', exercises: [] }
}

function setToDraft(s: RoutineSet): DraftSet {
  const reps = s.reps_min === null ? '' : s.reps_min === s.reps_max || s.reps_max === null ? String(s.reps_min) : `${s.reps_min}-${s.reps_max}`
  return {
    key: uuid(),
    set_type: s.set_type,
    reps,
    weight: s.weight_kg === null ? '' : formatDecimal(Number(s.weight_kg)),
    duration: s.duration_seconds === null ? '' : formatDuration(s.duration_seconds),
    distance: s.distance_m === null ? '' : formatDecimal(s.distance_m / 1000),
  }
}

export function routineToDraft(routine: Routine): RoutineDraft {
  return {
    id: routine.id,
    isNew: false,
    name: routine.name,
    notes: routine.notes,
    exercises: routine.exercises.map((e) => ({
      key: uuid(),
      exercise: e.exercise,
      rest_seconds: e.rest_seconds,
      notes: e.notes,
      sets: e.sets.map(setToDraft),
    })),
  }
}

/** Pretvara nacrt u telo zahteva; baca DraftError sa porukom za korisnika. */
export function draftToPayload(draft: RoutineDraft): RoutinePayload {
  if (!draft.name.trim()) throw new DraftError('nameRequired')
  if (!draft.exercises.length) throw new DraftError('noExercises')

  return {
    id: draft.id,
    name: draft.name.trim(),
    notes: draft.notes,
    exercises: draft.exercises.map((e) => {
      if (!e.sets.length) throw new DraftError('noSets', { exercise: e.exercise.name })
      const m = e.exercise.measurement
      const usesReps = m !== 'duration' && m !== 'distance_duration'
      const usesWeight = m === 'weight_reps' || m === 'weighted_bodyweight' || m === 'assisted_bodyweight'
      return {
        exercise_id: e.exercise.id,
        rest_seconds: e.rest_seconds,
        notes: e.notes,
        sets: e.sets.map((s) => {
          const [reps_min, reps_max] = usesReps ? parseRepRange(s.reps) : [null, null]
          const weight = usesWeight ? parseOptionalDecimal(s.weight, e.exercise.name) : null
          const km = m === 'distance_duration' ? parseOptionalDecimal(s.distance, e.exercise.name) : null
          return {
            set_type: s.set_type,
            reps_min,
            reps_max,
            weight_kg: weight === null ? null : String(weight),
            duration_seconds: usesReps ? null : parseDuration(s.duration),
            distance_m: km === null ? null : Math.round(km * 1000),
          }
        }),
      }
    }),
  }
}
