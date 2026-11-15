/**
 * Sledeća rutina: posle one koja je poslednja odrađena, redom kao u listi rutina (ukrug).
 * Bez odrađenih treninga iz rutine predlaže se prva rutina.
 */
export function nextRoutine<R extends { id: string }>(routines: R[], sessions: { routine_id: string | null; started_at: string }[]): R | null {
  if (!routines.length) return null
  const last = [...sessions]
    .filter((s) => s.routine_id && routines.some((r) => r.id === s.routine_id))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
  if (!last) return routines[0]
  const i = routines.findIndex((r) => r.id === last.routine_id)
  return routines[(i + 1) % routines.length]
}
