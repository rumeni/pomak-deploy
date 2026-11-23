import type { Equipment, MeasurementType, Muscle } from './api'

// Nazivi se prevode preko ključeva muscle.*, equipment.* i measurement.* (vidi i18n/sr.ts).
export const MUSCLES: Muscle[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'glutes', 'core', 'full_body', 'cardio']

export const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other']

export const MEASUREMENTS: MeasurementType[] = [
  'weight_reps',
  'bodyweight_reps',
  'weighted_bodyweight',
  'assisted_bodyweight',
  'duration',
  'distance_duration',
]

export const REST_OPTIONS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300]

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "10" -> "10 + 10" for an exercise done one side at a time (the value is per side). */
export function bothSides(text: string, exercise: { unilateral?: boolean } | undefined | null): string {
  return exercise?.unilateral && text ? `${text} + ${text}` : text
}

/** Volume counts both sides: weight per dumbbell, or reps per side (not both, see Exercise.volume_factor). */
export function volumeFactor(exercise: { load_mode: string; unilateral?: boolean }): number {
  return exercise.load_mode === 'per_side' || exercise.unilateral ? 2 : 1
}
