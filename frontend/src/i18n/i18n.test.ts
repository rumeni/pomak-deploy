import { describe, expect, it } from 'vitest'

import { en } from './en'
import { sr } from './sr'

const PLURAL = /_(one|few|other)$/

/** Svi ključevi kao "a.b.c"; oblici množine se svode na osnovni ključ. */
function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k.replace(PLURAL, '')}`],
  )
}

function placeholders(obj: object, prefix = ''): Record<string, string[]> {
  return Object.entries(obj).reduce<Record<string, string[]>>((acc, [k, v]) => {
    if (typeof v === 'object') return { ...acc, ...placeholders(v, `${prefix}${k}.`) }
    const key = `${prefix}${k.replace(PLURAL, '')}`
    acc[key] = [...(v as string).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    return acc
  }, {})
}

describe('prevodi', () => {
  it('srpski i engleski imaju iste ključeve', () => {
    expect([...new Set(keys(en))].sort()).toEqual([...new Set(keys(sr))].sort())
  })

  it('isti ključ koristi iste promenljive ({{...}}) u oba jezika', () => {
    expect(placeholders(en)).toEqual(placeholders(sr))
  })

  it('korisnički tekstovi koriste trening umesto rutine / workout instead of routine', () => {
    const values = (obj: object): string[] => Object.values(obj).flatMap((value) =>
      typeof value === 'string' ? [value] : typeof value === 'object' && value !== null ? values(value) : [],
    )
    expect(values(sr).filter((value) => /\brutin[a-z]*\b/i.test(value))).toEqual([])
    expect(values(en).filter((value) => /\broutines?\b/i.test(value))).toEqual([])
  })

  it('srpska množina ima sva tri oblika', () => {
    const flat = JSON.stringify(sr)
    for (const base of ['exercises', 'workingSets']) {
      for (const form of ['one', 'few', 'other']) expect(flat).toContain(`"${base}_${form}"`)
    }
  })
})
