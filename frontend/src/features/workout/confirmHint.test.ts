import { beforeEach, describe, expect, it, vi } from 'vitest'

import { confirmHintSeen, markConfirmHintSeen } from './confirmHint'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
})

describe('the "mark each set" hint', () => {
  it('is dismissed per account: another account on the device still sees it', () => {
    expect(confirmHintSeen('a')).toBe(false)
    markConfirmHintSeen('a')
    expect(confirmHintSeen('a')).toBe(true)
    expect(confirmHintSeen('b')).toBe(false)
  })

  it('without storage it is simply shown again', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(confirmHintSeen('a')).toBe(false)
    expect(() => markConfirmHintSeen('a')).not.toThrow()
  })
})
