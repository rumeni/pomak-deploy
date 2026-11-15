import { formatDecimal } from '../../lib/format'

/** Broj za prikaz, zaokružen na jednu decimalu; nepoznata vrednost je "?" (nikad 0). */
export function fmtValue(value: number | string | null): string {
  return value === null ? '?' : formatDecimal(Math.round(Number(value) * 10) / 10)
}

