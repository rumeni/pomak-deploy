let locale = 'sr-Latn-RS'

/** Postavlja jezik za brojeve i datume (poziva i18n pri promeni jezika). */
export function setFormatLocale(value: string): void {
  locale = value
}

export function getFormatLocale(): string {
  return locale
}

/** "sreda, 23. septembar" / "Wednesday, 23 September" */
export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

/** "20. 9. 2026." / "9/20/2026" */
export function formatShortDate(isoDate: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(fromISODate(isoDate))
}

/**
 * Čita broj koji je korisnik ukucao: prihvata i zarez i tačku ("78,5" i "78.5").
 * Vraća null za prazno ili neispravno, npr. "1.234,5" ili "7,8,5", umesto da tiho promeni vrednost.
 */
export function parseDecimal(input: string): number | null {
  const text = input.trim().replace(/\s/g, '')
  if (!/^\d+([.,]\d+)?$/.test(text)) return null
  return Number(text.replace(',', '.'))
}

/** 78.5 -> "78,5" na srpskom, "78.5" na engleskom */
export function formatDecimal(value: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(value)
}

/** Lokalni datum kao "2026-09-24" (ne UTC, da posle ponoći ne bi upisalo prethodni dan). */
export function toISODate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}


/** "2026-09-30" + n dana (lokalni kalendar, bez pomeranja zbog letnjeg računanja vremena). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d + n))
}

/** Datum iz "2026-09-30" kao lokalni dan. */
export function fromISODate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d)
}
