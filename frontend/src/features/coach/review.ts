/** Workout review helpers without React. */

import { formatDecimal } from '../../lib/format'
import type { PlanSet } from './plansApi'

type T = (key: string, options?: Record<string, unknown>) => string

/**
 * Planned sets in a compact, readable form: "3 × 8-10 @ 60 kg, RPE 8". Consecutive working
 * sets with the same prescription are grouped; warm-ups are counted apart. The plan comes from
 * the client's app, so every field may be missing.
 */
export function describePlannedSets(sets: Partial<PlanSet>[], t: T): string {
  const warmups = sets.filter((s) => s.set_type === 'warmup').length
  const groups: { count: number; label: string }[] = []
  for (const s of sets.filter((x) => x.set_type !== 'warmup')) {
    const reps = s.reps_min == null ? '' : s.reps_max != null && s.reps_max !== s.reps_min ? `${s.reps_min}-${s.reps_max}` : String(s.reps_min)
    const parts = [
      reps,
      s.weight_kg != null ? `@ ${formatDecimal(Number(s.weight_kg))} kg` : '',
      s.duration_seconds != null ? `${Math.round(s.duration_seconds / 6) / 10} min` : '',
      s.distance_m != null ? `${formatDecimal(s.distance_m / 1000)} km` : '',
      s.rpe != null ? `RPE ${formatDecimal(Number(s.rpe))}` : '',
    ].filter(Boolean)
    const label = parts.join(' ')
    const last = groups.at(-1)
    if (last && last.label === label) last.count += 1
    else groups.push({ count: 1, label })
  }
  const working = groups.map((g) => (g.label ? `${g.count} × ${g.label}` : t('coachSpace.review.sets', { count: g.count }))).join(', ')
  const warm = warmups ? t('coachSpace.review.warmups', { count: warmups }) : ''
  return [warm, working].filter(Boolean).join(' + ') || '–'
}
