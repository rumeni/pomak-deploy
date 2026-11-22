/** A workout needs at least one exercise to be assigned. The coach's private exercises are fine:
 * the server copies them to the client as the client's own (labelled with the coach). */
export type CoachRoutineAvailability = 'ready' | 'empty'

export function coachRoutineAvailability(routine: { exercises: ReadonlyArray<unknown> }): CoachRoutineAvailability {
  return routine.exercises.length ? 'ready' : 'empty'
}
