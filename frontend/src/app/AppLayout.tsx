import { Outlet } from 'react-router-dom'

import { TabBar } from '../components/TabBar'

export function AppLayout() {
  return (
    <div className="pt-safe mx-auto min-h-full max-w-xl pb-28">
      {/* Pozadina ispod statusne trake telefona, da sadržaj koji se pomera ne ide ispod sata. */}
      <div aria-hidden className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-surface" />
      <Outlet />
      <TabBar />
    </div>
  )
}
