/** Calendar helpers without React: local dates as YYYY-MM-DD keys, weeks, grouping, labels. */

import { getFormatLocale } from '../../lib/format'

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar date of a moment, as YYYY-MM-DD. */
export function dayKey(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A YYYY-MM-DD key as a local Date at midnight. */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: string, days: number): string {
  const d = fromKey(key)
  d.setDate(d.getDate() + days)
  return dayKey(d)
}

/** The Monday of the week a date is in (Monday = first day, as on the server). */
export function mondayOf(key: string): string {
  const weekday = (fromKey(key).getDay() + 6) % 7
  return addDays(key, -weekday)
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Server weekday (Monday = 0) of a date key. */
export function weekdayOf(key: string): number {
  return (fromKey(key).getDay() + 6) % 7
}

/** Items by local start day, each day in time order. */
export function groupByDay<T>(items: T[], startOf: (item: T) => string): Map<string, T[]> {
  const days = new Map<string, T[]>()
  for (const item of [...items].sort((a, b) => startOf(a).localeCompare(startOf(b)))) {
    const key = dayKey(startOf(item))
    days.set(key, [...(days.get(key) ?? []), item])
  }
  return days
}

/** 09:30 */
export function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString(getFormatLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** pon, 24. nov */
export function dayLabel(key: string, long = false): string {
  return fromKey(key).toLocaleDateString(getFormatLocale(), long
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: 'numeric', month: 'short' })
}

/** A local date and HH:MM as an ISO moment (the device's time zone). */
export function localMoment(key: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = fromKey(key)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/** Whether two HH:MM ranges of one day overlap (touching ends do not). */
export function rangesOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start < b.end && b.start < a.end
}
