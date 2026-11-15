import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/danas', label: 'tabs.today', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { to: '/trening', label: 'tabs.training', icon: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8' },
  { to: '/ishrana', label: 'tabs.nutrition', icon: 'M7 3v8a2 2 0 002 2v8M11 3v8M7 7h4M16 3c-2 2-2 6 0 8v10' },
  { to: '/napredak', label: 'tabs.progress', icon: 'M4 18l6-6 4 4 6-8M16 8h4v4' },
  { to: '/trener', label: 'tabs.coach', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
]

/** Same destinations: mobile floating dock / desktop sidebar. Also used by Capacitor Android. */
export function TabBar() {
  const { t } = useTranslation()
  return (
    <nav className="app-nav" aria-label={t('common.appName')}>
      <div className="app-nav-brand" aria-hidden>
        <span className="brand-wordmark">POMAK</span>
      </div>
      <ul className="app-nav-list">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={tab.icon} />
              </svg>
              <span>{t(tab.label)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
