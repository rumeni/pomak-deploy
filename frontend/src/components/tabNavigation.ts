/** Routes shared by the floating dock and optional horizontal page swipes. */
export type Tab = { to: string; label: string; icon: string; end?: boolean }

const TODAY: Tab = { to: '/danas', label: 'tabs.today', icon: 'M3 12l9-8 9 8M5 10v10h14V10' }
const TRAINING: Tab = { to: '/trening', label: 'tabs.training', icon: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8' }
const NUTRITION: Tab = { to: '/ishrana', label: 'tabs.nutrition', icon: 'M7 3v8a2 2 0 002 2v8M11 3v8M7 7h4M16 3c-2 2-2 6 0 8v10' }
const PROGRESS: Tab = { to: '/napredak', label: 'tabs.progress', icon: 'M4 18l6-6 4 4 6-8M16 8h4v4' }
const COACH: Tab = { to: '/trener', label: 'tabs.coach', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' }

/** A client's tabs: the coach tab is where a collaboration lives (or starts). */
export const CLIENT_TABS = [TODAY, TRAINING, NUTRITION, PROGRESS, COACH]
/** A coach's own training and food: no coach tab, the coach space is one switch away. */
export const COACH_PERSONAL_TABS = [TODAY, TRAINING, NUTRITION, PROGRESS]
/** The coach space. */
export const COACH_SPACE_TABS: Tab[] = [
  { to: '/trener', end: true, label: 'coachSpace.tabs.overview', icon: 'M4 5h16M4 12h16M4 19h10' },
  { to: '/trener/klijenti', label: 'coachSpace.tabs.clients', icon: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-5-5.9' },
  { to: '/trener/kalendar', label: 'coachSpace.tabs.calendar', icon: 'M7 3v4M17 3v4M4 9h16M5 5h14v15H5z' },
  { to: '/trener/programi', label: 'coachSpace.tabs.programs', icon: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8' },
  { to: '/trener/poruke', label: 'coachSpace.tabs.messages', icon: 'M4 5h16v11H8l-4 4z' },
]


export function tabRoutes(pathname: string, isCoach: boolean): readonly Tab[] {
  if (!isCoach) return CLIENT_TABS
  return pathname === '/trener' || pathname.startsWith('/trener/') ? COACH_SPACE_TABS : COACH_PERSONAL_TABS
}

export function tabIndex(pathname: string, tabs: readonly Tab[]): number {
  return tabs.findIndex((tab) => pathname === tab.to || (!tab.end && pathname.startsWith(tab.to + '/')))
}

/** Only switch main tab screens; do not swipe out of nested editors or details. */
export function swipeDestination(
  pathname: string, tabs: readonly Tab[], dx: number, dy: number, elapsedMs: number, startX: number, viewportWidth: number,
): string | null {
  const current = tabs.findIndex((tab) => tab.to === pathname)
  if (current < 0 || elapsedMs > 900 || elapsedMs < 0 || Math.abs(dx) < 72) return null
  if (Math.abs(dx) < Math.abs(dy) * 1.6) return null
  // Leave the OS/browser's back gesture alone at either edge.
  if (startX < 24 || startX > viewportWidth - 24) return null
  const next = current + (dx < 0 ? 1 : -1)
  return tabs[next]?.to ?? null
}

/** Resolve the actual tab under the finger on release, not just the old active tab.
 * A decisive swipe to an adjacent segment commits navigation. A small drag is
 * only a visual preview and must not alter the selected tab.
 */
export function dockSwipeTarget(
  active: number, startX: number, startY: number, endX: number, endY: number,
  dockLeft: number, dockWidth: number, count: number,
): number | null {
  if (count < 2 || active < 0 || active >= count) return null
  const dx = endX - startX
  const dy = endY - startY
  if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy) * 1.2) return null
  const segment = (dockWidth - 10) / count
  if (segment <= 0) return null
  const raw = Math.round((endX - dockLeft - 5) / segment - 0.5)
  let target = Math.max(0, Math.min(count - 1, raw))
  // If the finger stops just short of a segment boundary, treat a decisive
  // directional swipe as navigation by one tab rather than snapping back.
  if (target === active && Math.abs(dx) >= segment * 0.55) {
    target = Math.max(0, Math.min(count - 1, active + (dx < 0 ? 1 : -1)))
  }
  return target === active ? null : target
}
