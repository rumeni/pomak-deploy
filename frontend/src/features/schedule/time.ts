/**
 * Calendar helpers without React. The schedule lives in one explicit zone (the server's
 * `time_zone`, Europe/Belgrade), whatever zone the device is in: days, labels and the times the
 * coach types are all in that zone. Day keys are YYYY-MM-DD in it; date arithmetic on keys is
 * pure calendar math (UTC), never the device's clock.
 */

import { getFormatLocale } from '../../lib/format'

export const SCHEDULE_TZ = 'Europe/Belgrade'

const pad = (n: number) => String(n).padStart(2, '0')

function parts(ms: number, tz: string) {
  const values: Record<string, number> = {}
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') values[p.type] = Number(p.value)
  }
  return values as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

/** How far the zone's wall clock is ahead of UTC at this instant (ms). */
function offset(ms: number, tz: string): number {
  const p = parts(ms, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (ms - (ms % 1000))
}

/** The schedule day of an instant, as YYYY-MM-DD. */
export function dayKey(value: Date | string | number, tz = SCHEDULE_TZ): string {
  const p = parts(typeof value === 'number' ? value : new Date(value).getTime(), tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/**
 * A wall-clock time on a schedule day as an ISO instant, the same rule as the server: a time
 * skipped by the spring clock change moves forward by the gap, a repeated autumn time is the
 * first of the two.
 */
export function zonedMoment(key: string, hhmm: string, tz = SCHEDULE_TZ): string {
  const [y, m, d] = key.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi)
  // The offsets just before and after this wall time; the earlier real instant wins (fold=0).
  const before = wall - offset(wall - 3 * 3600_000, tz)
  const after = wall - offset(wall + 3 * 3600_000, tz)
  const shows = (ms: number) => {
    const p = parts(ms, tz)
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall
  }
  const valid = [before, after].filter(shows).sort((x, z) => x - z)
  // None shows it: a skipped time, moved forward by the gap (the offset from before it).
  return new Date(valid[0] ?? before).toISOString()
}

const utcDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const keyOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export function addDays(key: string, days: number): string {
  const d = utcDay(key)
  d.setUTCDate(d.getUTCDate() + days)
  return keyOf(d)
}

/** Server weekday (Monday = 0) of a date key. */
export function weekdayOf(key: string): number {
  return (utcDay(key).getUTCDay() + 6) % 7
}

/** The Monday of the week a date is in (Monday = first day, as on the server). */
export function mondayOf(key: string): string {
  return addDays(key, -weekdayOf(key))
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Items by schedule start day, each day in time order. */
export function groupByDay<T>(items: T[], startOf: (item: T) => string, tz = SCHEDULE_TZ): Map<string, T[]> {
  const days = new Map<string, T[]>()
  for (const item of [...items].sort((a, b) => Date.parse(startOf(a)) - Date.parse(startOf(b)))) {
    const key = dayKey(startOf(item), tz)
    days.set(key, [...(days.get(key) ?? []), item])
  }
  return days
}

/** [start, end) of a schedule day, as epoch ms. */
export function dayRange(key: string, tz = SCHEDULE_TZ): [number, number] {
  return [Date.parse(zonedMoment(key, '00:00', tz)), Date.parse(zonedMoment(addDays(key, 1), '00:00', tz))]
}

/** The items that overlap a schedule day (also ones that started earlier or run past midnight). */
export function onDay<T>(items: T[], key: string, startOf: (item: T) => string, endOf: (item: T) => string, tz = SCHEDULE_TZ): T[] {
  const [start, end] = dayRange(key, tz)
  return items
    .filter((item) => Date.parse(startOf(item)) < end && Date.parse(endOf(item)) > start)
    .sort((a, b) => Date.parse(startOf(a)) - Date.parse(startOf(b)))
}

/** How an interval looks on one day: whole day, or clipped at the day's start or end. */
export function spanOnDay(startIso: string, endIso: string, key: string, tz = SCHEDULE_TZ) {
  const [start, end] = dayRange(key, tz)
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  return {
    wholeDay: s <= start && e >= end,
    from: s > start ? timeLabel(startIso, tz) : null,
    to: e < end ? timeLabel(endIso, tz) : null,
  }
}

/** 09:30, in the schedule zone. */
export function timeLabel(value: string, tz = SCHEDULE_TZ): string {
  return new Date(value).toLocaleTimeString(getFormatLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
}

/** pon, 24. nov (a calendar date: no zone shifts it). */
export function dayLabel(key: string, long = false): string {
  return utcDay(key).toLocaleDateString(getFormatLocale(), long
    ? { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }
    : { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
}

/** Whether this device shows a different zone than the schedule (then the UI says which one). */
export function deviceZoneDiffers(tz = SCHEDULE_TZ): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone !== tz
  } catch {
    return false
  }
}

/** Whether two HH:MM ranges of one day overlap (touching ends do not). */
export function rangesOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start < b.end && b.start < a.end
}

/** YYYY-MM-DD and HH:MM inputs that are filled in and valid. */
export function validDayTime(key: string, hhmm: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && /^\d{2}:\d{2}$/.test(hhmm)
}
