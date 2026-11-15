import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useActiveWorkoutRow } from './store'

/** Podsetnik da je trening započet (npr. posle zatvaranja aplikacije), sa povratkom na njega. */
export function ActiveWorkoutBanner() {
  const { t } = useTranslation()
  const row = useActiveWorkoutRow()
  if (!row) return null
  return (
    <Link to="/trening/aktivan" className="flex items-center gap-3 rounded-2xl bg-brand p-4 text-white shadow-sm active:bg-brand-dark">
      <span className="relative flex size-3">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
        <span className="relative inline-flex size-3 rounded-full bg-white" />
      </span>
      <span className="flex-1">
        <span className="block text-sm opacity-90">{t('workout.inProgress')}</span>
        <span className="block font-semibold">{row.workout.name}</span>
      </span>
      <span className="font-semibold">{t('workout.resume')} →</span>
    </Link>
  )
}
