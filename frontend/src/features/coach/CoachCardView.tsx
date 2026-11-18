import { useTranslation } from 'react-i18next'

import type { CoachCard } from './api'
import { Avatar } from './Avatar'
import { coachPhotoPath } from './pictures'

/** Who the coach is: shown to a client before connecting and on the Coach tab afterwards. */
export function CoachCardView({ coach }: { coach: CoachCard }) {
  const { t } = useTranslation()
  const place = [coach.gym_name, coach.city].filter(Boolean).join(', ')
  const mapsQuery = [coach.gym_name, coach.address, coach.city].filter(Boolean).join(', ')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={coach.name || '?'} size="lg" photo={coachPhotoPath(coach)} />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{coach.name}</p>
          <p className="text-sm text-muted">
            {[
              coach.years_experience != null ? t('coachSpace.card.years', { count: coach.years_experience }) : null,
              coach.work_mode ? t(`coachSpace.workMode.${coach.work_mode}`) : null,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {coach.specialties.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('coachSpace.profile.specialties')}>
          {coach.specialties.map((s) => <li key={s} className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-dark">{t(`coachSpace.specialty.${s}`)}</li>)}
        </ul>
      )}
      {place && (
        <p className="text-sm">
          {place}
          {coach.address && <span className="text-muted"> · {coach.address}</span>}
          {' '}
          <a className="font-semibold underline" target="_blank" rel="noreferrer noopener"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}>
            {t('coachSpace.card.openMap')}
          </a>
        </p>
      )}
      {coach.bio && <p className="whitespace-pre-wrap text-sm">{coach.bio}</p>}
      {coach.qualifications && (
        <div className="text-sm">
          <p className="font-semibold">{t('coachSpace.profile.qualifications')}</p>
          <p className="whitespace-pre-wrap">{coach.qualifications}</p>
          <p className="mt-1 text-xs text-muted">{t('coachSpace.card.selfReported')}</p>
        </div>
      )}
    </div>
  )
}
