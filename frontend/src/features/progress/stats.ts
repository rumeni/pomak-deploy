import type { ChartPoint } from '../../components/chart'
import type { Muscle } from '../training/api'
import { readinessBand, readinessScore, type Readiness } from '../workout/rpe'

export type StatsPeriod = '7' | '30' | '90' | 'all'
export const STATS_PERIODS: StatsPeriod[] = ['7', '30', '90', 'all']

export interface PeriodTotals {
  sessions: number
  working_sets: number
  /** Whole kilograms as text ("12450"). */
  volume_kg: string
  avg_rpe: string | null
  /** Working sets that have an RPE (what avg_rpe is based on). */
  rpe_sets: number
  /** Exact sum of those RPEs, for averages over several groups. */
  rpe_sum: string
}

export interface ReadinessEntry {
  session_id: string
  date: string
  name: string
  readiness: Readiness
  working_sets: number
  volume_kg: string
  avg_rpe: string | null
  rpe_sets: number
  rpe_sum: string
}

export interface TopLift {
  exercise_id: string
  exercise: string
  e1rm: string
  weight_kg: string
  reps: number
  rpe: string | null
  date: string
  session_id: string
  /** Weight is per dumbbell / side. */
  per_side: boolean
  /** This period's best is also the all-time best. */
  personal_best: boolean
}

export interface TrainingStats {
  period: StatsPeriod
  first_day: string | null
  last_day: string
  /** Days the period really covers (for "all": since the first workout). */
  days: number
  /** The weekly chart shows only the latest weeks of a longer history. */
  weeks_capped: boolean
  totals: PeriodTotals
  /** Same-length period just before; null for "all". */
  previous: PeriodTotals | null
  weeks: (PeriodTotals & { week_start: string })[]
  muscles: { muscle: Muscle; working_sets: number }[]
  top_lifts: TopLift[]
  readiness: ReadinessEntry[]
}

/** Change against the previous period; no percentage when there was nothing before. */
export function change(current: number, previous: number | null | undefined): { diff: number; pct: number | null } | null {
  if (previous === null || previous === undefined) return null
  return { diff: current - previous, pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null }
}

/**
 * Average per week over the period's real length - never per chart bar (bars are capped and
 * edge weeks can be partial). Periods shorter than a week count as one week.
 */
export function perWeek(total: number, days: number): number {
  return total / (Math.max(days, 7) / 7)
}

/** Change of average RPE in RPE points; none when either period has no RPE logged. */
export function rpeChange(current: string | null, previous: string | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined) return null
  return Math.round((Number(current) - Number(previous)) * 10) / 10
}

/** How many of the six questions were answered. */
export function answerCount(r: Partial<Readiness>): number {
  return Object.values(r).filter((v) => v !== null && v !== undefined).length
}

/** One readiness answer (or the overall score) over time, skipping workouts without it. */
export function readinessSeries(entries: ReadinessEntry[], field: keyof Readiness | 'score'): ChartPoint[] {
  return entries.flatMap((e) => {
    const value = field === 'score' ? readinessScore(e.readiness) : e.readiness[field]
    return typeof value === 'number' ? [{ date: e.date, value }] : []
  })
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

/** Fewer workouts than this in a group, and the comparison says too little to show. */
export const MIN_COMPARE = 3

interface Group { count: number; avgSets: number | null; avgRpe: number | null }

/**
 * Workouts on high-readiness days (score 75+) next to low-readiness days (under 50): how many
 * working sets and how hard they felt. A description of the athlete's own history, not a
 * prediction - and the app never changes loads because of it.
 */
export function readinessComparison(entries: ReadinessEntry[]): { high: Group; low: Group; enough: boolean } {
  const group = (band: 'high' | 'low'): Group => {
    const rows = entries.filter((e) => {
      const score = readinessScore(e.readiness)
      return score !== null && readinessBand(score) === band
    })
    // Exact sums, rounded only at the end.
    const rpeSets = rows.reduce((n, e) => n + e.rpe_sets, 0)
    const rpeSum = rows.reduce((n, e) => n + Number(e.rpe_sum || 0), 0)
    return {
      count: rows.length,
      avgSets: average(rows.map((e) => e.working_sets)),
      avgRpe: rpeSets ? rpeSum / rpeSets : null,
    }
  }
  const high = group('high')
  const low = group('low')
  return { high, low, enough: high.count >= MIN_COMPARE && low.count >= MIN_COMPARE }
}
