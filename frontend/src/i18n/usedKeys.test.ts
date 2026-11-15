import { describe, expect, it } from 'vitest'

import { en } from './en'
import { sr } from './sr'

// Sav izvorni kod aplikacije kao tekst (bez testova), da se pronađu ključevi prevoda u pozivima t('...').
const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.ts', '!../i18n/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function has(tree: unknown, key: string): boolean {
  const parts = key.split('.')
  let node: unknown = tree
  for (const [i, part] of parts.entries()) {
    if (typeof node !== 'object' || node === null) return false
    const obj = node as Record<string, unknown>
    // Množina: ključ "x" postoji ako postoje "x_one"/"x_other".
    if (i === parts.length - 1 && !(part in obj)) return `${part}_one` in obj || `${part}_other` in obj
    node = obj[part]
  }
  return node !== undefined
}

describe('ključevi prevoda', () => {
  const used = new Set<string>()
  for (const code of Object.values(sources)) {
    for (const m of code.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)'/g)) used.add(m[1])
  }

  it('pronađeno je dovoljno ključeva (provera same pretrage)', () => {
    expect(used.size).toBeGreaterThan(200)
  })

  it('svaki ključ korišćen u kodu postoji na oba jezika', () => {
    const missing = [...used].filter((k) => !has(sr, k) || !has(en, k))
    expect(missing).toEqual([])
  })
})
