import { formatDecimal } from '../../lib/format'
import { bothSides } from '../training/labels'

export interface CoachSet {
  set_type: 'warmup' | 'working'
  reps: number | null
  weight_kg: string | null
  duration_seconds: number | null
  distance_m: number | null
}

/** Format each complete set first, then join fields; warmup is a prefix, not an extra "×" item. */
/** `unilateral`: reps and time were entered per side and read "10 + 10". */
export function formatCoachSet(set: CoachSet, warmupLabel: string, repsLabel: string, unilateral = false): string {
  const side = { unilateral }
  const parts = [
    set.weight_kg !== null ? `${formatDecimal(Number(set.weight_kg))} kg` : '',
    set.reps !== null ? `${bothSides(String(set.reps), side)} ${repsLabel}` : '',
    set.duration_seconds !== null ? `${bothSides(formatDecimal(set.duration_seconds), side)} s` : '',
    set.distance_m !== null ? `${formatDecimal(set.distance_m)} m` : '',
  ].filter(Boolean)
  return `${set.set_type === 'warmup' ? `${warmupLabel} ` : ''}${parts.join(' × ')}`.trim()
}
