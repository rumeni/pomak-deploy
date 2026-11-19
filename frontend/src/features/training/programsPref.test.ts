import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const events: string[] = []

beforeEach(() => {
  vi.resetModules()
  store.clear()
  events.length = 0
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  vi.stubGlobal('window', { dispatchEvent: (e: Event) => void events.push(e.type) })
  vi.stubGlobal('Event', class { type: string; constructor(type: string) { this.type = type } })
})

describe('hiding the suggested programs', () => {
  it('applies only to the account that hid them and can be undone', async () => {
    const { programsHidden, setProgramsHidden } = await import('./programsPref')
    expect(programsHidden('a')).toBe(false)
    setProgramsHidden('a', true)
    expect(programsHidden('a')).toBe(true)
    expect(programsHidden('b')).toBe(false)
    setProgramsHidden('a', false)
    expect(programsHidden('a')).toBe(false)
    expect(store.size).toBe(0)
  })

  it('tells the open screens (Profil and Trening) about the change', async () => {
    const { setProgramsHidden } = await import('./programsPref')
    setProgramsHidden('a', true)
    expect(events).toEqual(['pomak:programs-pref'])
  })

  it('without storage the choice still holds for this session', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    const { programsHidden, setProgramsHidden } = await import('./programsPref')
    expect(() => setProgramsHidden('a', true)).not.toThrow()
    expect(programsHidden('a')).toBe(true)
    expect(programsHidden('b')).toBe(false)
  })
})
