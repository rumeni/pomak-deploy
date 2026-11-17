import type { TFunction } from 'i18next'

import type { Exercise } from '../training/api'

/** One input of a set row; which ones a set has depends on how the exercise is measured. */
export type Field = { field: 'weight' | 'reps' | 'duration' | 'distance'; label: string; inputMode: 'decimal' | 'numeric' | 'text' }

export function inputFields(m: Exercise['measurement'], perSide: boolean, t: TFunction): Field[] {
  const reps: Field = { field: 'reps', label: t('routine.colReps'), inputMode: 'numeric' }
  const time: Field = { field: 'duration', label: t('routine.colTime'), inputMode: 'text' }
  const weight = (label: string): Field => ({ field: 'weight', label, inputMode: 'decimal' })
  switch (m) {
    case 'weight_reps':
      return [weight(perSide ? t('routine.colKgPerDumbbell') : t('routine.colKg')), reps]
    case 'weighted_bodyweight':
      return [weight(t('routine.colAddedKg')), reps]
    case 'assisted_bodyweight':
      return [weight(t('routine.colAssistKg')), reps]
    case 'bodyweight_reps':
      return [reps]
    case 'duration':
      return [time]
    case 'distance_duration':
      return [{ field: 'distance', label: t('routine.colKm'), inputMode: 'decimal' }, time]
  }
}
