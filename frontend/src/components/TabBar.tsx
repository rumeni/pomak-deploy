import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import { useUnreadTotal } from '../features/coach/inboxApi'
import { isCoachSpacePath } from '../features/coach/workspace'
import { useAuth } from '../lib/auth'

type Tab = { to: string; label: string; icon: string; end?: boolean }

const TODAY: Tab = { to: '/danas', label: 'tabs.today', icon: 'M3 12l9-8 9 8M5 10v10h14V10' }
const TRAINING: Tab = { to: '/trening', label: 'tabs.training', icon: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8' }
const NUTRITION: Tab = { to: '/ishrana', label: 'tabs.nutrition', icon: 'M7 3v8a2 2 0 002 2v8M11 3v8M7 7h4M16 3c-2 2-2 6 0 8v10' }
const PROGRESS: Tab = { to: '/napredak', label: 'tabs.progress', icon: 'M4 18l6-6 4 4 6-8M16 8h4v4' }
const COACH: Tab = { to: '/trener', label: 'tabs.coach', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' }

/** A client's tabs: the coach tab is where a collaboration lives (or starts). */
const CLIENT_TABS = [TODAY, TRAINING, NUTRITION, PROGRESS, COACH]
/** A coach's own training and food: no coach tab, the coach space is one switch away. */
const COACH_PERSONAL_TABS = [TODAY, TRAINING, NUTRITION, PROGRESS]
/** The coach space. The calendar joins in a later phase. */
const COACH_SPACE_TABS: Tab[] = [
  { to: '/trener', end: true, label: 'coachSpace.tabs.overview', icon: 'M4 5h16M4 12h16M4 19h10' },
  { to: '/trener/klijenti', label: 'coachSpace.tabs.clients', icon: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-5-5.9' },
  { to: '/trener/programi', label: 'coachSpace.tabs.programs', icon: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8' },
  { to: '/trener/poruke', label: 'coachSpace.tabs.messages', icon: 'M4 5h16v11H8l-4 4z' },
]

function useTabs(): { tabs: Tab[]; coachSpace: boolean } {
  const { me } = useAuth()
  const { pathname } = useLocation()
  if (!me?.profile.is_coach) return { tabs: CLIENT_TABS, coachSpace: false }
  const coachSpace = isCoachSpacePath(pathname)
  return { tabs: coachSpace ? COACH_SPACE_TABS : COACH_PERSONAL_TABS, coachSpace }
}

/** Same destinations: mobile floating dock / desktop sidebar. Also used by Capacitor Android. */
export function TabBar() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { tabs, coachSpace } = useTabs()
  const unread = useUnreadTotal(!!me).data?.total ?? 0
  // Where conversations live: the coach space's messages, or the client's coach tab.
  const inboxTab = coachSpace ? '/trener/poruke' : me?.profile.is_coach ? null : '/trener'
  return (
    <nav className="app-nav" aria-label={t('common.appName')}>
      <div className="app-nav-brand" aria-hidden>
        <span className="brand-wordmark">POMAK</span>
        {coachSpace && <span className="app-nav-brand-sub">COACH</span>}
      </div>
      <ul className="app-nav-list">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={tab.icon} />
              </svg>
              <span>{t(tab.label)}</span>
              {tab.to === inboxTab && unread > 0 && (
                <span className="app-nav-badge" aria-label={t('coach.unread', { count: unread })}>{unread > 99 ? '99+' : unread}</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
