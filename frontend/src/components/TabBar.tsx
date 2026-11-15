import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/danas', label: 'tabs.today', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { to: '/trening', label: 'tabs.training', icon: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8' },
  { to: '/ishrana', label: 'tabs.nutrition', icon: 'M7 3v8a2 2 0 002 2v8M11 3v8M7 7h4M16 3c-2 2-2 6 0 8v10' },
  { to: '/napredak', label: 'tabs.progress', icon: 'M4 18l6-6 4 4 6-8M16 8h4v4' },
  { to: '/trener', label: 'tabs.coach', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
]

export function TabBar() {
  const { t } = useTranslation()
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 backdrop-blur">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                `flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${
                  isActive ? 'text-brand' : 'text-muted'
                }`
              }
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={tab.icon} />
              </svg>
              {t(tab.label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
