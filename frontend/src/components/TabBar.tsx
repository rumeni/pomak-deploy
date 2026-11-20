import { useRef, useState, type CSSProperties, type MouseEvent, type TouchEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useUnreadTotal } from '../features/coach/inboxApi'
import { usePushSync } from '../lib/usePushSync'
import { useAuth } from '../lib/auth'
import { dockSwipeTarget, tabIndex, tabRoutes } from './tabNavigation'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Same destinations on mobile and desktop; only the mobile dock gets liquid-glass motion. */
export function TabBar() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { pathname, key: routeKey } = useLocation()
  const navigate = useNavigate()
  const coachSpace = !!me?.profile.is_coach && (pathname === '/trener' || pathname.startsWith('/trener/'))
  const tabs = tabRoutes(pathname, !!me?.profile.is_coach)
  const active = tabIndex(pathname, tabs)
  const [drag, setDrag] = useState<{ routeKey: string; position: number } | null>(null)
  const touch = useRef<{ x: number; y: number; active: number } | null>(null)
  // iOS can synthesize a click on the old link after touchend. Block only that click.
  const suppressClick = useRef(false)
  const unread = useUnreadTotal(!!me).data?.total ?? 0
  usePushSync(me?.id ?? null)
  const inboxTab = coachSpace ? '/trener/poruke' : me?.profile.is_coach ? null : '/trener'
  // A new history entry has a new key, so old gesture state can never override its active tab.
  const isDragging = drag?.routeKey === routeKey
  const indicator = isDragging ? drag.position : Math.max(0, active)

  const touchStart = (event: TouchEvent<HTMLElement>) => {
    // A fresh tap must never inherit a previously suppressed synthetic click.
    suppressClick.current = false
    touch.current = null
    if (window.matchMedia('(min-width: 980px)').matches || event.touches.length !== 1 || active < 0) return
    const x = event.touches[0].clientX
    if (x < 24 || x > window.innerWidth - 24) return // Preserve iOS edge navigation.
    touch.current = { x, y: event.touches[0].clientY, active }
  }

  const touchMove = (event: TouchEvent<HTMLElement>) => {
    if (!touch.current || event.touches.length !== 1) return
    const dx = event.touches[0].clientX - touch.current.x
    const dy = event.touches[0].clientY - touch.current.y
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.15) return
    const segment = (event.currentTarget.clientWidth - 10) / tabs.length
    setDrag({ routeKey, position: clamp(touch.current.active + dx / segment, 0, tabs.length - 1) })
  }

  const touchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touch.current
    touch.current = null
    if (!start || event.changedTouches.length !== 1) { setDrag(null); return }
    const end = event.changedTouches[0]
    const bounds = event.currentTarget.getBoundingClientRect()
    const target = dockSwipeTarget(
      start.active, start.x, start.y, end.clientX, end.clientY,
      bounds.left, bounds.width, tabs.length,
    )
    if (target === null || target === start.active) { setDrag(null); return }

    // Commit the selected tab, don't snap the lens back before router state updates.
    // Suppress Safari's delayed link click, which used to navigate to the old tab.
    suppressClick.current = true
    event.preventDefault()
    setDrag({ routeKey, position: target })
    navigate(tabs[target].to, { state: { tabMotion: target > start.active ? 'next' : 'prev' } })
  }

  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <nav className="app-nav" aria-label={t('common.appName')}
      onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}
      onClickCapture={onClickCapture}
      onTouchCancel={() => { touch.current = null; setDrag(null); suppressClick.current = false }}>
      <div className="app-nav-brand" aria-hidden>
        <span className="brand-wordmark">POMAK</span>
        {coachSpace && <span className="app-nav-brand-sub">COACH</span>}
      </div>
      <ul className="app-nav-list" style={{ '--dock-count': tabs.length } as CSSProperties}>
        <li aria-hidden="true" className={isDragging ? 'app-nav-glider is-dragging' : 'app-nav-glider'}
          style={{ transform: `translate3d(${indicator * 100}%, 0, 0)`, transition: isDragging ? 'none' : undefined }}>
          <span key={routeKey} className="app-nav-liquid-sheen" />
        </li>
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
