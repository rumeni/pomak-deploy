import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'

import { PageHeader } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { useOnline } from '../../lib/useOnline'
import { initials, isCoachSpacePath } from './workspace'

/** Coach only: one tap between the coach space and the coach's own training and food. */
export function SpaceSwitch() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { pathname } = useLocation()
  if (!me?.profile.is_coach) return null
  const inCoachSpace = isCoachSpacePath(pathname)
  return (
    <Link
      to={inCoachSpace ? '/danas' : '/trener'}
      className="space-switch"
      aria-label={t(inCoachSpace ? 'coachSpace.switchToPersonalAria' : 'coachSpace.switchToCoachAria')}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" />
      </svg>
      <span>{t(inCoachSpace ? 'coachSpace.switchToPersonal' : 'coachSpace.switchToCoach')}</span>
    </Link>
  )
}

/** Header of the coach space's main screens: switch and the coach's profile (language is under Profil). */
export function CoachHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const name = me?.profile.display_name || me?.email || '?'
  const online = useOnline()
  return (
    <>
    <PageHeader
      title={title}
      subtitle={subtitle}
      action={
        <>
          {action}
          <SpaceSwitch />
          <Link
            to="/trener/profil"
            aria-label={t('coachSpace.profileAria')}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-dark"
          >
            {initials(name)}
          </Link>
        </>
      }
    />
    {!online && (
      <p role="status" className="mx-4 mb-3 rounded-xl bg-brand-soft px-4 py-3 text-sm">{t('coachSpace.offlineBanner')}</p>
    )}
    </>
  )
}
