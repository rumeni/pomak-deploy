/**
 * RPE (rate of perceived exertion) and the pre-workout readiness check-in.
 *
 * RPE 10 = no rep and no extra weight left; RPE 8 = two reps left in reserve.
 * The percentage chart below is the one coaches hand out with RPE programs; the backend
 * uses the same values for the estimated 1RM (backend/training/progress.py).
 */

/** Values offered in the app, hardest first. */
export const RPE_OPTIONS = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4] as const

/** Share of 1RM (in %) for 1-10 reps at a given RPE. */
const CHART: Record<string, readonly number[]> = {
  '10': [100, 96, 92, 89, 86, 84, 81, 79, 76, 74],
  '9.5': [98, 94, 91, 88, 85, 82, 80, 77, 75, 73],
  '9': [96, 92, 89, 86, 84, 81, 79, 77, 74, 72],
  '8.5': [94, 91, 88, 85, 82, 80, 77, 75, 73, 71],
  '8': [92, 89, 86, 84, 81, 79, 76, 74, 72, 70],
  '7.5': [91, 88, 85, 82, 80, 77, 75, 73, 71, 69],
  '7': [89, 86, 84, 81, 79, 76, 74, 72, 70, 68],
  '6.5': [88, 85, 82, 80, 77, 75, 74, 72, 69, 67],
  '6': [86, 84, 81, 79, 76, 74, 73, 71, 68, 66],
  '5.5': [85, 82, 80, 77, 75, 73, 72, 70, 67, 65],
  '5': [85, 82, 80, 77, 75, 73, 72, 70, 67, 65],
  '4.5': [84.5, 81.5, 79.5, 76.5, 74.5, 72.5, 71.5, 69.5, 66.5, 64.5],
  '4': [84, 81, 79, 76, 74, 72, 71, 69, 66, 64],
}

/** Below RPE 6 a set is too far from failure to say much about the max. */
const MIN_RPE_FOR_ESTIMATE = 6
const MAX_REPS_FOR_ESTIMATE = 10

export function isRpe(value: unknown): value is number {
  return typeof value === 'number' && (RPE_OPTIONS as readonly number[]).includes(value)
}

/** "8" / "8.0" / 8 -> 8; anything outside the scale -> null. */
export function parseRpe(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return isRpe(n) ? n : null
}

/** Share of 1RM (0-1) for a set of `reps` at `rpe`, or null outside the chart. */
export function percentOf1rm(reps: number, rpe: number): number | null {
  const row = CHART[String(rpe)]
  if (!row || !Number.isInteger(reps) || reps < 1 || reps > MAX_REPS_FOR_ESTIMATE) return null
  return row[reps - 1] / 100
}

/** Estimated 1RM from one set: the chart when RPE is 6+, otherwise Epley (assumes failure). */
export function estimated1rm(weight: number, reps: number, rpe: number | null): number | null {
  if (!(weight > 0) || !Number.isInteger(reps) || reps < 1 || reps > MAX_REPS_FOR_ESTIMATE) return null
  const pct = rpe !== null && rpe >= MIN_RPE_FOR_ESTIMATE ? percentOf1rm(reps, rpe) : null
  if (pct) return weight / pct
  return reps === 1 ? weight : weight * (1 + reps / 30)
}

/** Weight for `reps` @ `rpe`, from an estimated 1RM, rounded to what can be loaded. */
export function weightForTarget(e1rm: number, reps: number, rpe: number, step: number): number | null {
  const pct = percentOf1rm(reps, rpe)
  if (!pct || !(e1rm > 0)) return null
  const weight = Math.round((e1rm * pct) / step) * step
  return weight > 0 ? Math.round(weight * 100) / 100 : null
}

/** How many reps were left in reserve, for the scale description. */
export function repsInReserve(rpe: number): { min: number; max: number } | null {
  if (rpe >= 10) return null
  if (rpe === 9.5) return { min: 0, max: 1 }
  const left = 10 - rpe
  return Number.isInteger(left) ? { min: left, max: left } : { min: Math.floor(left), max: Math.ceil(left) }
}

export function formatRpe(rpe: number): string {
  return Number.isInteger(rpe) ? String(rpe) : String(rpe).replace('.', ',')
}

/* ---------- Readiness check-in ---------- */

export type ScaleField = 'motivation' | 'stress' | 'soreness_upper' | 'soreness_lower' | 'hydration'

export interface Readiness {
  sleep_hours: number | null
  hydration: number | null
  stress: number | null
  motivation: number | null
  soreness_upper: number | null
  soreness_lower: number | null
}

/** Order on screen. For stress and soreness a higher answer means worse readiness. */
export const SCALE_FIELDS: { field: ScaleField; inverted: boolean }[] = [
  { field: 'motivation', inverted: false },
  { field: 'stress', inverted: true },
  { field: 'soreness_upper', inverted: true },
  { field: 'soreness_lower', inverted: true },
  { field: 'hydration', inverted: false },
]

/** 4 means "4 or less" and 10 means "10 or more". */
export const SLEEP_OPTIONS = [4, 5, 6, 7, 8, 9, 10] as const

export const sleepLabel = (h: number) => (h <= 4 ? '≤4' : h >= 10 ? '10+' : String(h))

/** Word set for the answer: stress is the only masculine noun ("nizak stres" vs "niska motivacija"). */
export const LEVEL_SET: Record<ScaleField, 'levelF' | 'levelM'> = {
  motivation: 'levelF', stress: 'levelM', soreness_upper: 'levelF', soreness_lower: 'levelF', hydration: 'levelF',
}

export const EMPTY_READINESS: Readiness = {
  sleep_hours: null, hydration: null, stress: null, motivation: null, soreness_upper: null, soreness_lower: null,
}

export function hasReadiness(r: Partial<Readiness> | null | undefined): r is Readiness {
  return !!r && Object.values(r).some((v) => v !== null && v !== undefined)
}

function sleepScore(hours: number): number {
  if (hours >= 8) return 5
  if (hours <= 4) return 1
  return hours - 3 // 5 h -> 2, 6 h -> 3, 7 h -> 4
}

/**
 * One number for "how ready am I today", 0-100, from the answers given (unanswered ones are
 * skipped). Every answer counts the same; stress and soreness count in reverse.
 */
export function readinessScore(r: Partial<Readiness> | null | undefined): number | null {
  if (!r) return null
  const scores: number[] = []
  if (typeof r.sleep_hours === 'number') scores.push(sleepScore(r.sleep_hours))
  for (const { field, inverted } of SCALE_FIELDS) {
    const value = r[field]
    if (typeof value === 'number') scores.push(inverted ? 6 - value : value)
  }
  if (!scores.length) return null
  const average = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.round(((average - 1) / 4) * 100)
}

/** Colour band for the score: low < 50 <= ok < 75 <= high. */
export function readinessBand(score: number): 'low' | 'ok' | 'high' {
  return score < 50 ? 'low' : score < 75 ? 'ok' : 'high'
}
