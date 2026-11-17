import { parseDecimal } from '../../lib/format'

/**
 * Do the calories fit the macros (4 / 4 / 9 kcal per gram)? Same tolerance as the server uses
 * for shared foods: 20 % or 25 kcal, since labels round and count fibre differently.
 * Null while a value is missing or not a number.
 */
export function kcalCheck(values: { kcal: string; protein_g: string; carbs_g: string; fat_g: string }): { ok: boolean; expected: number } | null {
  const [kcal, p, c, f] = [values.kcal, values.protein_g, values.carbs_g, values.fat_g].map((v) => (v.trim() ? parseDecimal(v) : null))
  if (kcal === null || p === null || c === null || f === null) return null
  const expected = 4 * p + 4 * c + 9 * f
  return { ok: Math.abs(kcal - expected) <= Math.max(25, expected * 0.2), expected: Math.round(expected) }
}
