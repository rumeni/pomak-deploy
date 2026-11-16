import type { GoalKind } from './api'

/** Mirrors backend progress.serializers.LIMITS; API remains authoritative. */
export function goalRange(kind: GoalKind): [number, number] {
  if (kind === 'workouts_per_week') return [1, 14]
  return kind === 'weight' ? [25, 350] : [10, 250]
}

export function goalValueInRange(kind: GoalKind, value: number): boolean {
  const [min, max] = goalRange(kind)
  return Number.isFinite(value) && min <= value && value <= max
}
