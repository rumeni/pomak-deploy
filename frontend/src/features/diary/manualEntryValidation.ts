import { parseDecimal } from '../../lib/format'

export type ManualValueField = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'

type ParsedManualValue =
  | { ok: true; value: string | null }
  | { ok: false; error: 'invalid' | 'range' | 'precision'; max: number; places: number }

/**
 * Match the API's MealEntryWriteSerializer limits BEFORE persisting a local
 * offline operation. Invalid values must not appear in optimistic diary totals
 * only to be rejected hours later by the server.
 *
 * kcal: Decimal(7,1), 0..10000; macros: Decimal(7,2), 0..1000.
 * Blank optional macros remain null, not zero.
 */
export function parseManualValue(field: ManualValueField, raw: string): ParsedManualValue {
  const max = field === 'kcal' ? 10000 : 1000
  const places = field === 'kcal' ? 1 : 2
  const text = raw.trim()
  if (!text) return { ok: true, value: null }

  const value = parseDecimal(text)
  if (value === null || !Number.isFinite(value)) return { ok: false, error: 'invalid', max, places }
  if (value > max) return { ok: false, error: 'range', max, places }

  // Do not silently round a number the user supplied with too many decimals.
  // parseDecimal already rejects ambiguous thousands separators and negatives.
  const normalized = text.replace(/\s/g, '')
  const fractional = normalized.split(/[.,]/)[1]
  if ((fractional?.length ?? 0) > places) return { ok: false, error: 'precision', max, places }

  return { ok: true, value: String(value) }
}
