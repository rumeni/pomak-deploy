import { addDays } from '../../lib/format'

type Session = { id: string; startedAt: string; status: 'sent' | 'pending' | 'rejected' }

// The backend counts workouts using Django's Europe/Belgrade timezone. A
// device in another timezone must assign pending workouts to the same days.
const progressDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function progressDate(date: Date): string {
  const parts = progressDateFormatter.formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

/**
 * Nedelja na ekranu Danas: dani sa treningom i treninzi koji još čekaju slanje.
 * Neposlat trening se računa (radi i bez interneta), odbijen ne; isti trening se ne broji dvaput.
 */
export function weekActivity(server: Session[], local: Session[], monday: string) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const sentIds = new Set(server.map((s) => s.id))
  const unsent = local.filter((s) => s.status === 'pending' && !sentIds.has(s.id))
  const dayOf = (s: Session) => progressDate(new Date(s.startedAt))
  const trained = new Set([...server, ...unsent].map(dayOf))
  const unsentThisWeek = unsent.filter((s) => days.includes(dayOf(s))).length
  return { days, trained, unsentThisWeek }
}

/** Shows locally queued workouts even when the server weekly summary is unavailable. */
export function workoutCountWithPending(serverCount: number | undefined, pendingCount: number): number | null {
  if (serverCount === undefined) return pendingCount > 0 ? pendingCount : null
  return serverCount + pendingCount
}
