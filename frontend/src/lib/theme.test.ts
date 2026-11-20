// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_STORAGE_KEY, currentTheme, initializeTheme, setTheme, subscribeTheme, validTheme } from './theme'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.pomakTheme
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.pomakTheme
})

describe('device appearance preference', () => {
  it('preserves the existing POMAK palette until changed', () => {
    expect(validTheme(null)).toBe('original')
    expect(validTheme('invalid')).toBe('original')
    initializeTheme()
    expect(currentTheme()).toBe('original')
    expect(document.documentElement.dataset.pomakTheme).toBe('original')
  })

  it('persists light and blue themes without changing application routes', () => {
    setTheme('light')
    expect(currentTheme()).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    setTheme('blue')
    expect(currentTheme()).toBe('blue')
    initializeTheme()
    expect(currentTheme()).toBe('blue')
    setTheme('original')
    expect(currentTheme()).toBe('original')
  })

  it('updates the current document for changes from another tab', () => {
    const notify = vi.fn()
    const unsubscribe = subscribeTheme(notify)
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'blue' }))
    expect(currentTheme()).toBe('blue')
    expect(notify).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new StorageEvent('storage', { key: 'other-setting', newValue: 'light' }))
    expect(notify).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('keeps the chosen theme for the current session when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => setTheme('light')).not.toThrow()
    expect(currentTheme()).toBe('light')
  })
})
