import { Outlet } from 'react-router-dom'

import { TabBar } from '../components/TabBar'

/** Responsive shell is shared by browser and the Capacitor Android WebView. */
export function AppLayout() {
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
