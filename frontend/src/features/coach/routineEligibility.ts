/** Only populated workouts using shared exercises can be copied to another user's account. */
export type CoachRoutineAvailability = 'ready' | 'empty' | 'private'

export function coachRoutineAvailability(routine: {
  exercises: ReadonlyArray<{ exercise: { is_custom: boolean } }>
}): CoachRoutineAvailability {
  if (!routine.exercises.length) return 'empty'
  if (routine.exercises.some((item) => item.exercise.is_custom)) return 'private'
  return 'ready'
}
