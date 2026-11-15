import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const secureStore = vi.hoisted(() => new Map<string, string>())
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    getItem: async (key: string) => secureStore.get(key) ?? null,
    setItem: async (key: string, value: string) => { secureStore.set(key, value) },
    removeItem: async (key: string) => { secureStore.delete(key) },
  },
}))

import { tokens } from './tokens'

beforeEach(async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  })
  await tokens.clear()
  secureStore.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('native Keystore atomic session', () => {
  it('persists only the refresh JWT in Keystore; access stays in memory', async () => {
    await tokens.set('access-A', 'refresh-A')
    expect(secureStore.get('pomak.refresh')).toBe('refresh-A')
    expect(tokens.access()).toBe('access-A')
    expect(localStorage.getItem('pomak.access')).toBeNull()
    expect(localStorage.getItem('pomak.refresh')).toBeNull()
  })

  it('a late rotation cannot reintroduce credentials after logout', async () => {
    await tokens.set('access-A', 'refresh-A')
    const session = tokens.session()
    const stale = tokens.rotate('access-A2', 'refresh-A2', session, 'refresh-A')
    const cleared = tokens.clear()
    expect(await stale).toBe(false)
    await cleared
    expect(await tokens.refresh()).toBeNull()
    expect(tokens.access()).toBeNull()
  })

  it('a new native login wins over an in-flight prior-account rotation', async () => {
    await tokens.set('access-A', 'refresh-A')
    const old = tokens.session()
    const stale = tokens.rotate('access-A2', 'refresh-A2', old, 'refresh-A')
    const cleared = tokens.clear()
    const next = tokens.set('access-B', 'refresh-B')
    await Promise.all([stale, cleared, next])
    expect(secureStore.get('pomak.refresh')).toBe('refresh-B')
    expect(tokens.access()).toBe('access-B')
    expect(tokens.isCurrent(old)).toBe(false)
  })
})
