import { addDays, toISODate } from '../../lib/format'

type Session = { id: string; startedAt: string; status: 'sent' | 'pending' | 'rejected' }

/**
 * Nedelja na ekranu Danas: dani sa treningom i treninzi koji još čekaju slanje.
 * Neposlat trening se računa (radi i bez interneta), odbijen ne; isti trening se ne broji dvaput.
 */
export function weekActivity(server: Session[], local: Session[], monday: string) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const sentIds = new Set(server.map((s) => s.id))
  const unsent = local.filter((s) => s.status === 'pending' && !sentIds.has(s.id))
  const dayOf = (s: Session) => toISODate(new Date(s.startedAt))
  const trained = new Set([...server, ...unsent].map(dayOf))
  const unsentThisWeek = unsent.filter((s) => days.includes(dayOf(s))).length
  return { days, trained, unsentThisWeek }
}

/** Shows locally queued workouts even when the server weekly summary is unavailable. */
export function workoutCountWithPending(serverCount: number | undefined, pendingCount: number): number | null {
  if (serverCount === undefined) return pendingCount > 0 ? pendingCount : null
  return serverCount + pendingCount
}
