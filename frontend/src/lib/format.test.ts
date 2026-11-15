import { describe, expect, it } from 'vitest'

import { addDays, formatDecimal, formatLongDate, parseDecimal, setFormatLocale, toISODate } from './format'

describe('parseDecimal', () => {
  it('prihvata zarez i tačku', () => {
    expect(parseDecimal('78,5')).toBe(78.5)
    expect(parseDecimal('78.5')).toBe(78.5)
    expect(parseDecimal(' 180 ')).toBe(180)
  })

  it('odbija dvosmislene i neispravne unose umesto da promeni vrednost', () => {
    expect(parseDecimal('1.234,5')).toBeNull()
    expect(parseDecimal('7,8,5')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('-5')).toBeNull()
  })
})

describe('formatDecimal i formatLongDate', () => {
  it('prate izabrani jezik', () => {
    setFormatLocale('sr-Latn-RS')
    expect(formatDecimal(78.5)).toBe('78,5')
    expect(formatDecimal(1250)).toBe('1250')
    expect(formatLongDate(new Date(2026, 8, 24))).toBe('četvrtak, 24. septembar')

    setFormatLocale('en-GB')
    expect(formatDecimal(78.5)).toBe('78.5')
    expect(formatLongDate(new Date(2026, 8, 24))).toBe('Thursday 24 September')
    setFormatLocale('sr-Latn-RS')
  })
})

describe('toISODate', () => {
  it('koristi lokalni datum', () => {
    expect(toISODate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})


describe('addDays', () => {
  it('prelazi mesec, godinu i promenu na zimsko računanje vremena', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26') // 25.10. se sat vraća unazad
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30') // 29.03. se sat pomera unapred
  })
})
