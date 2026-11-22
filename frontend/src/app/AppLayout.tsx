import { useEffect, useRef, type TouchEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ErrorBoundary } from '../components/ErrorBoundary'
import { TabBar } from '../components/TabBar'
import { swipeDestination, tabRoutes } from '../components/tabNavigation'
import { isCoachSpacePath, rememberSpace } from '../features/coach/workspace'
import { useAuth } from '../lib/auth'

/** Avoid stealing gestures from form fields, buttons, links or horizontally scrollable content. */
function isInteractiveTouch(target: EventTarget | null, root: HTMLElement): boolean {
  let element = target instanceof Element ? target : null
  while (element && element !== root) {
    if (element.matches('a,button,input,textarea,select,[contenteditable="true"],[role="slider"],[data-tab-swipe-ignore]')) return true
    if (element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 8) {
      const overflow = getComputedStyle(element).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
    element = element.parentElement
  }
  return false
}

/** Responsive shell shared by the browser and Capacitor Android WebView. */
export function AppLayout() {
  const { me } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { pathname } = location
  const isCoach = !!me?.profile.is_coach
  const start = useRef<{ x: number; y: number; at: number } | null>(null)
  const tabs = tabRoutes(pathname, isCoach)
  useEffect(() => {
    if (isCoach && me) rememberSpace(me.id, isCoachSpacePath(pathname) ? 'coach' : 'personal')
  }, [isCoach, me, pathname])

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    start.current = null
    if (window.matchMedia('(min-width: 980px)').matches || event.touches.length !== 1) return
    if (!tabs.some((tab) => tab.to === pathname) || isInteractiveTouch(event.target, event.currentTarget)) return
    start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() }
  }
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const origin = start.current
    start.current = null
    if (!origin || event.changedTouches.length !== 1) return
    const dx = event.changedTouches[0].clientX - origin.x
    const dy = event.changedTouches[0].clientY - origin.y
    const next = swipeDestination(pathname, tabs, dx, dy, Date.now() - origin.at, origin.x, window.innerWidth)
    if (next) navigate(next, { state: { tabMotion: dx < 0 ? 'next' : 'prev' } })
  }
  const direction = (location.state as { tabMotion?: string } | null)?.tabMotion
  const animation = direction === 'next' ? 'app-tab-enter-next' : direction === 'prev' ? 'app-tab-enter-prev' : ''
  return (
    <div className="app-shell pt-safe">
      <div aria-hidden className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-surface min-[980px]:hidden" />
      <main className="app-content" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={() => { start.current = null }}>
        <div key={pathname} className={animation}><ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary></div>
      </main>
      <TabBar />
    </div>
  )
}
