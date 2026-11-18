/** Plan helpers without React: dates, the change notice, and tailoring a routine for one client. */

import { formatDecimal, fromISODate, getFormatLocale, parseDecimal, toISODate } from '../../lib/format'
import { DraftError, parseRepRange } from '../training/draft'
import { parseRpe } from '../workout/rpe'
import type { ClientPlan, PlanRoutine, PlanSet, PlanVersion, TailoredRoutine, Weekday } from './plansApi'

/** A plan date ("2026-11-23") as a short local date. */
export function planDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short' })
}

/** Weekday of a date as on the server: 0 = Monday ... 6 = Sunday. */
export function weekdayOf(date: Date): Weekday {
  return ((date.getDay() + 6) % 7) as Weekday
}

/** The next Monday after today (the usual start of a new program). */
export function nextMonday(today: Date): string {
  const days = 7 - weekdayOf(today)
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
  return toISODate(date)
}

/** The plan change a client should be told about: the newest current/upcoming version made in the last week. */
export function changeNotice(plan: ClientPlan | null | undefined, now: Date): PlanVersion | null {
  if (!plan) return null
  const weekAgo = now.getTime() - 7 * 86_400_000
  const recent = plan.versions
    .filter((v) => v.state !== 'past' && new Date(v.created_at).getTime() >= weekAgo)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return recent[0] ?? null
}

/** A set while the coach adjusts it: text as typed ("8-10", "62,5"). */
export interface TailorSet {
  set_type: PlanSet['set_type']
  reps: string
  weight: string
  rpe: string
  /** Kept as they are (time/distance exercises are not adjusted here). */
  duration_seconds: number | null
  distance_m: number | null
}

export interface TailorDraft {
  name: string
  exercises: {
    exercise_id: string
    name: string
    measurement: string
    rest_seconds: number | null
    notes: string
    sets: TailorSet[]
  }[]
}

const repsText = (s: PlanSet) =>
  s.reps_min == null ? '' : s.reps_max != null && s.reps_max !== s.reps_min ? `${s.reps_min}-${s.reps_max}` : String(s.reps_min)

export function tailorDraft(routine: PlanRoutine, nameSuffix: string): TailorDraft {
  return {
    name: routine.name.endsWith(nameSuffix) ? routine.name : `${routine.name} ${nameSuffix}`.slice(0, 100),
    exercises: routine.exercises.map((e) => ({
      exercise_id: e.exercise_id, name: e.name, measurement: e.measurement, rest_seconds: e.rest_seconds, notes: e.notes,
      sets: e.sets.map((s) => ({
        set_type: s.set_type,
        reps: repsText(s),
        weight: s.weight_kg == null ? '' : formatDecimal(Number(s.weight_kg)),
        rpe: s.rpe == null ? '' : formatDecimal(Number(s.rpe)),
        duration_seconds: s.duration_seconds,
        distance_m: s.distance_m,
      })),
    })),
  }
}

/** The tailored routine for the server; throws DraftError (routine.errors.*) on invalid input. */
export function tailoredRoutine(draft: TailorDraft): TailoredRoutine {
  if (!draft.name.trim()) throw new DraftError('nameRequired')
  return {
    name: draft.name.trim(),
    notes: '',
    exercises: draft.exercises.map((e) => {
      if (!e.sets.length) throw new DraftError('noSets', { exercise: e.name })
      return {
        exercise_id: e.exercise_id, rest_seconds: e.rest_seconds, notes: e.notes,
        sets: e.sets.map((s) => {
          const [reps_min, reps_max] = parseRepRange(s.reps)
          const weight = s.weight.trim() ? parseDecimal(s.weight) : null
          if (s.weight.trim() && (weight === null || weight < 0 || weight > 1000)) throw new DraftError('invalidNumber', { exercise: e.name, value: s.weight })
          const rpe = s.rpe.trim() ? parseRpe(s.rpe) : null
          if (s.rpe.trim() && rpe === null) throw new DraftError('invalidNumber', { exercise: e.name, value: s.rpe })
          return {
            set_type: s.set_type, reps_min, reps_max,
            weight_kg: weight === null ? null : String(weight),
            duration_seconds: s.duration_seconds, distance_m: s.distance_m,
            rpe: rpe === null ? null : String(rpe),
          }
        }),
      }
    }),
  }
}
