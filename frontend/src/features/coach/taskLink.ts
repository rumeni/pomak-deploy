import type { CoachTask } from './tasks'

/** Where a task leads: the workout it is about, the week's review, or the client. */
export function taskLink(task: CoachTask): { to: string; kind: 'workout' | 'week' | 'client' } {
  if (task.data.workout_id) return { to: `/trener/klijenti/${task.client.id}/trening/${task.data.workout_id}`, kind: 'workout' }
  if (task.kind === 'weekly_checkin' && task.data.week_start) {
    return { to: `/trener/klijenti/${task.client.id}/nedelja?od=${task.data.week_start}`, kind: 'week' }
  }
  return { to: `/trener/klijenti/${task.client.id}`, kind: 'client' }
}
