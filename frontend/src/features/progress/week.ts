import { addDays, fromISODate } from '../../lib/format'

/** Ponedeljak nedelje u kojoj je dan ("2026-09-30" -> "2026-09-28"). */
export function mondayOf(isoDate: string): string {
  const weekday = (fromISODate(isoDate).getDay() + 6) % 7
  return addDays(isoDate, -weekday)
}
