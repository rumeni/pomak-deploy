import { useRef, useState, type CSSProperties, type TouchEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useUnreadTotal } from '../features/coach/inboxApi'
import { usePushSync } from '../lib/usePushSync'
import { useAuth } from '../lib/auth'
import { tabIndex, tabRoutes } from './tabNavigation'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Same destinations on mobile and desktop; only the mobile dock gets liquid-glass motion. */
export function TabBar() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const coachSpace = !!me?.profile.is_coach && (pathname === '/trener' || pathname.startsWith('/trener/'))
  const tabs = tabRoutes(pathname, !!me?.profile.is_coach)
  const active = tabIndex(pathname, tabs)
  const [drag, setDrag] = useState<number | null>(null)
  const touch = useRef<{ x: number; y: number; active: number } | null>(null)
  const unread = useUnreadTotal(!!me).data?.total ?? 0
  usePushSync(me?.id ?? null)
  const inboxTab = coachSpace ? '/trener/poruke' : me?.profile.is_coach ? null : '/trener'
  const indicator = drag ?? Math.max(0, active)

  const touchStart = (event: TouchEvent<HTMLElement>) => {
    touch.current = null
    if (window.matchMedia('(min-width: 980px)').matches || event.touches.length !== 1 || active < 0) return
    touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, active }
  }
  const touchMove = (event: TouchEvent<HTMLElement>) => {
    if (!touch.current || event.touches.length !== 1) return
    const dx = event.touches[0].clientX - touch.current.x
    const dy = event.touches[0].clientY - touch.current.y
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return
    const segment = (event.currentTarget.clientWidth - 12) / tabs.length
    setDrag(clamp(touch.current.active + dx / segment, 0, tabs.length - 1))
  }
  const touchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touch.current
    touch.current = null
    setDrag(null)
    if (!start || event.changedTouches.length !== 1) return
    const dx = event.changedTouches[0].clientX - start.x
    const dy = event.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    // Do not also click the link on which the finger was released.
    event.preventDefault()
    const segment = (event.currentTarget.clientWidth - 12) / tabs.length
    const steps = Math.max(1, Math.round(Math.abs(dx) / segment))
    const target = clamp(start.active + (dx < 0 ? steps : -steps), 0, tabs.length - 1)
    if (target !== start.active) navigate(tabs[target].to, { state: { tabMotion: dx < 0 ? 'next' : 'prev' } })
  }

  return (
    <nav className="app-nav" aria-label={t('common.appName')}
      onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}
      onTouchCancel={() => { touch.current = null; setDrag(null) }}>
      <div className="app-nav-brand" aria-hidden>
        <span className="brand-wordmark">POMAK</span>
        {coachSpace && <span className="app-nav-brand-sub">COACH</span>}
      </div>
      <ul className="app-nav-list" style={{ '--dock-count': tabs.length } as CSSProperties}>
        <li aria-hidden="true" className="app-nav-glider" style={{ transform: `translate3d(${indicator * 100}%, 0, 0)`, transition: drag === null ? undefined : 'none' }} />
        {tabs.map((tab, index) => (
          <li key={tab.to}>
            <NavLink to={tab.to} end={tab.end}
              state={index === active ? null : { tabMotion: index > active ? 'next' : 'prev' }}
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
