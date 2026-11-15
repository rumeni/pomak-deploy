import type { ChartPoint } from '../../components/chart'
import { formatDecimal } from '../../lib/format'
import { formatDuration } from '../training/labels'
import type { Measurement, RecordKey } from './api'

/** Vrednost rekorda za prikaz: "80 kg", "12", "1:30", "5,2 km". */
export function formatRecordValue(key: RecordKey, value: string | number, repsUnit: string): string {
  const n = Number(value)
  switch (key) {
    case 'heaviest':
    case 'e1rm':
    case 'best_set_volume':
    case 'session_volume':
      return `${formatDecimal(n)} kg`
    case 'most_reps':
    case 'session_reps':
      return `${n} ${repsUnit}`
    case 'longest_duration':
      return formatDuration(n)
    case 'longest_distance':
      return `${formatDecimal(Math.round(n / 10) / 100)} km`
  }
}

/** Merenja za grafikon: od najstarijeg, jedno po danu (poslednje upisano tog dana). */
export function measurementPoints(list: Measurement[]): ChartPoint[] {
  const byDay = new Map<string, number>()
  // Lista sa servera je od najnovijeg; prvo viđeno za dan je poslednje upisano.
  for (const m of list) if (!byDay.has(m.measured_on)) byDay.set(m.measured_on, Number(m.value))
  return [...byDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
}
