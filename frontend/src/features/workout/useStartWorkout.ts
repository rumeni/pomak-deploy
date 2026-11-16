import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { Routine } from '../training/api'
import { getCurrentUserId } from '../../lib/currentUser'
import { startEmpty, startFromRoutine } from './model'
import { loadPrevious } from './previous'
import { cancelRestEnd } from './restNotification'
import { getActiveWorkoutRow, startWorkoutIfUnchanged } from './store'

/**
 * Pokreće trening iz rutine ili prazan. Ako je drugi trening u toku, pita pre nego što ga
 * odbaci. Završeni treninzi su u redu za slanje, pa ih novi trening ne dira.
 */
export function useStartWorkout() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return async (routine: Routine | null) => {
    const current = await getActiveWorkoutRow()
    const ownerId = current?.ownerId ?? getCurrentUserId()
    if (!ownerId) return
    if (current) {
      if (!window.confirm(t('workout.replaceConfirm', { name: current.workout.name }))) return
      await cancelRestEnd()
    }
    const now = new Date()
    const workout = routine
      ? startFromRoutine(routine, await loadPrevious(routine.exercises.map((e) => e.exercise.id)), now)
      : startEmpty(t('workout.emptyName'), now)
    const started = await startWorkoutIfUnchanged(workout, current?.workout.id ?? null, ownerId)
    if (!started) {
      window.alert(t('workout.startConflict'))
      return
    }
    navigate('/trening/aktivan')
  }
}
