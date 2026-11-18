/** Weeks start on Monday, as on the server; dates are local "YYYY-MM-DD". */

import { fromISODate, getFormatLocale, toISODate } from '../../lib/format'

export const CHECKIN_WEEKS_BACK = 8
export const CHECKIN_SCALES = ['energy', 'progress', 'nutrition', 'satisfaction'] as const

/** A week from the address (?od=YYYY-MM-DD): its Monday, or this week's for anything invalid. */
export function mondayFromParam(value: string | null, today: Date): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(fromISODate(value).getTime()) ? thisMonday(fromISODate(value)) : thisMonday(today)
}

/** The Monday of the week a date is in. */
export function thisMonday(date: Date): string {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return toISODate(day)
}

export function shiftWeek(monday: string, weeks: number): string {
  const day = fromISODate(monday)
  day.setDate(day.getDate() + 7 * weeks)
  return toISODate(day)
}

/** "17. – 23. nov" */
export function weekLabel(monday: string): string {
  const start = fromISODate(monday)
  const end = fromISODate(shiftWeek(monday, 1))
  end.setDate(end.getDate() - 1)
  const locale = getFormatLocale()
  return `${start.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`
}

/** A check-in is for this week or one of the last eight (as the server allows). */
export function canCheckIn(monday: string, current: string): boolean {
  return monday <= current && monday >= shiftWeek(current, -CHECKIN_WEEKS_BACK)
}
