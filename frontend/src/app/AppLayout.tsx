import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { TabBar } from '../components/TabBar'
import { isCoachSpacePath, rememberSpace } from '../features/coach/workspace'
import { useAuth } from '../lib/auth'

/** Responsive shell is shared by browser and the Capacitor Android WebView. */
export function AppLayout() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const isCoach = !!me?.profile.is_coach
  // A coach reopens the app in the space used last.
  useEffect(() => {
    if (isCoach && me) rememberSpace(me.id, isCoachSpacePath(pathname) ? 'coach' : 'personal')
  }, [isCoach, me, pathname])
  return (
    <div className="app-shell pt-safe">
      <div aria-hidden className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-surface min-[980px]:hidden" />
      <main className="app-content">
        <Outlet />
      </main>
      <TabBar />
    </div>
  )
}
