import { daysSince, recordNames, type CoachTask } from './tasks'
import { planDate } from './plans'
import { readinessReasons } from './workspace'

type T = (key: string, options?: Record<string, unknown>) => string

/** Facts only: what happened and when, never a judgement about the client. */
export function taskText(task: CoachTask, t: T, english: boolean, now: Date): { title: string; detail?: string } {
  switch (task.kind) {
    case 'workout_review':
      return { title: t('coachSpace.task.workoutReview', { workout: task.data.workout ?? '' }), detail: when(task.event_at, t, now) }
    case 'inactive': {
      const days = daysSince(task.data.since ?? task.event_at, now)
      return {
        title: t('coachSpace.task.inactive', { count: days }),
        detail: task.data.last_workout_at ? t('coachSpace.task.lastWorkout', { when: when(task.data.last_workout_at, t, now) }) : t('coachSpace.task.noWorkoutYet'),
      }
    }
    case 'low_readiness': {
      const reasons = readinessReasons(task.data.answers ?? {}).map(({ field, value }) =>
        field === 'sleep_hours' ? t('readiness.sleepValue', { value }) : `${t(`readiness.${field}`)} ${value}/5`)
      return { title: t('coachSpace.task.lowReadiness', { score: task.data.score ?? 0, workout: task.data.workout ?? '' }), detail: reasons.join(' · ') || undefined }
    }
    case 'weekly_checkin':
      return { title: t('coachSpace.task.weeklyCheckin'), detail: t('coachSpace.week.of', { date: planDate(task.data.week_start ?? task.event_at.slice(0, 10)) }) }
    case 'personal_record':
      return { title: t('coachSpace.task.personalRecord', { lifts: recordNames(task, english).join(', ') }), detail: when(task.event_at, t, now) }
  }
}

function when(iso: string, t: T, now: Date): string {
  const days = daysSince(iso, now)
  return days === 0 ? t('coachSpace.today') : days === 1 ? t('coachSpace.yesterday') : t('coachSpace.daysAgo', { count: days })
}
