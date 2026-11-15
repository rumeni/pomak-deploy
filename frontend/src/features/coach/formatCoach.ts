import { formatDecimal } from '../../lib/format'

export interface CoachSet {
  set_type: 'warmup' | 'working'
  reps: number | null
  weight_kg: string | null
  duration_seconds: number | null
  distance_m: number | null
}

/** Format each complete set first, then join fields; warmup is a prefix, not an extra "×" item. */
export function formatCoachSet(set: CoachSet, warmupLabel: string, repsLabel: string): string {
  const parts = [
    set.weight_kg !== null ? `${formatDecimal(Number(set.weight_kg))} kg` : '',
    set.reps !== null ? `${set.reps} ${repsLabel}` : '',
    set.duration_seconds !== null ? `${formatDecimal(set.duration_seconds)} s` : '',
    set.distance_m !== null ? `${formatDecimal(set.distance_m)} m` : '',
  ].filter(Boolean)
  return `${set.set_type === 'warmup' ? `${warmupLabel} ` : ''}${parts.join(' × ')}`.trim()
}
