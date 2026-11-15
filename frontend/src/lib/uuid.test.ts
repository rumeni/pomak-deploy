import { afterEach, describe, expect, it, vi } from 'vitest'

import { uuid } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('koristi crypto.randomUUID kad postoji', () => {
    expect(uuid()).toMatch(V4)
  })

  it('pravi ispravan v4 i bez crypto.randomUUID (http preko IP adrese)', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) })
    const ids = new Set(Array.from({ length: 50 }, () => uuid()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(V4)
  })
})
