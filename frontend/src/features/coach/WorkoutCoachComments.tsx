import { useTranslation } from 'react-i18next'

import { useCoachDashboard } from './api'
import { CoachMessages } from './CoachMessages'

/** On the client's own workout: the coach's comments about it, and a reply (only with a coach). */
export function WorkoutCoachComments({ workoutId, selfId }: { workoutId: string; selfId: string }) {
  const { t } = useTranslation()
  const dashboard = useCoachDashboard()
  if (dashboard.data?.role !== 'client' || !dashboard.data.connection) return null
  return <CoachMessages selfId={selfId} workoutId={workoutId} title={t('coachSpace.review.coachComments')} />
}
