// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { programsHidden, setProgramsHidden, subscribeProgramsHidden } from './programsPref'

const KEY = 'pomak.hidePrograms.'

/** What another tab's write looks like here: the storage changes, then a storage event arrives. */
function otherTab(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }))
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  // Reset any unsaved session value left by a test.
  setProgramsHidden('a', false)
  setProgramsHidden('b', false)
  localStorage.clear()
})

describe('hiding the suggested programs', () => {
  it('applies only to the account that hid them and can be undone', () => {
    expect(programsHidden('a')).toBe(false)
    setProgramsHidden('a', true)
    expect(programsHidden('a')).toBe(true)
    expect(programsHidden('b')).toBe(false)
    setProgramsHidden('a', false)
    expect(programsHidden('a')).toBe(false)
    expect(localStorage.getItem(KEY + 'a')).toBeNull()
  })

  it('tells the open screens in this tab (Profil and Trening) about the change', () => {
    const onChange = vi.fn()
    const stop = subscribeProgramsHidden(onChange)
    setProgramsHidden('a', true)
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
    setProgramsHidden('a', false)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('hidden in one tab and restored in another: the first tab shows them again', () => {
    const onChange = vi.fn()
    const stop = subscribeProgramsHidden(onChange)
    setProgramsHidden('a', true)
    expect(programsHidden('a')).toBe(true)

    otherTab(KEY + 'a', null)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(programsHidden('a')).toBe(false)
    stop()
  })

  it('ignores storage events for other keys', () => {
    const onChange = vi.fn()
    const stop = subscribeProgramsHidden(onChange)
    otherTab('pomak.somethingElse', '1')
    expect(onChange).not.toHaveBeenCalled()
    stop()
  })

  it('when saving fails the choice holds for this session, until another tab changes it', () => {
    const stop = subscribeProgramsHidden(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    setProgramsHidden('a', true)
    expect(programsHidden('a')).toBe(true) // storage still says nothing: the session value wins
    expect(programsHidden('b')).toBe(false)
    vi.restoreAllMocks()

    otherTab(KEY + 'a', null) // restored in another tab: newer than this tab's unsaved choice
    expect(programsHidden('a')).toBe(false)
    stop()
  })

  it('when storage cannot be read at all, the choice still holds for this session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    expect(programsHidden('a')).toBe(false)
    expect(() => setProgramsHidden('a', true)).not.toThrow()
    expect(programsHidden('a')).toBe(true)
    setProgramsHidden('a', false)
    expect(programsHidden('a')).toBe(false)
  })
})
