// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_STORAGE_KEY, currentTheme, initializeTheme, resolveTheme, setTheme, subscribeTheme, validTheme } from './theme'

let isDark = false
const handlers = new Set<() => void>()

beforeEach(() => {
  localStorage.clear()
  isDark = false
  handlers.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return isDark },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, callback: () => void) => { handlers.add(callback) },
    removeEventListener: (_type: string, callback: () => void) => { handlers.delete(callback) },
  })))
  initializeTheme()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('mobile appearance', () => {
  it('defaults to Light, also on a phone set to dark', () => {
    expect(validTheme(null)).toBe('light')
    expect(currentTheme()).toBe('light')
    expect(document.documentElement.dataset.pomakMode).toBe('light')
    isDark = true
    handlers.forEach((notify) => notify())
    expect(currentTheme()).toBe('light')
    expect(document.documentElement.dataset.pomakMode).toBe('light')
  })

  it('System, once chosen, follows the device without reopening the application', () => {
    setTheme('system')
    isDark = true
    handlers.forEach((notify) => notify())
    expect(currentTheme()).toBe('system')
    expect(document.documentElement.dataset.pomakMode).toBe('dark')
    isDark = false
    handlers.forEach((notify) => notify())
    expect(document.documentElement.dataset.pomakMode).toBe('light')
  })

  it('manual light/dark wins over phone appearance until System is selected again', () => {
    setTheme('dark')
    expect(currentTheme()).toBe('dark')
    expect(document.documentElement.dataset.pomakMode).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    isDark = false
    handlers.forEach((notify) => notify())
    expect(document.documentElement.dataset.pomakMode).toBe('dark')
    setTheme('light')
    isDark = true
    handlers.forEach((notify) => notify())
    expect(document.documentElement.dataset.pomakMode).toBe('light')
    setTheme('system')
    expect(document.documentElement.dataset.pomakMode).toBe('dark')
  })

  it('migrates old Original and Blue selections to Light', () => {
    expect(validTheme('original')).toBe('light')
    expect(validTheme('blue')).toBe('light')
    localStorage.setItem(THEME_STORAGE_KEY, 'original')
    initializeTheme()
    expect(currentTheme()).toBe('light')
    localStorage.setItem(THEME_STORAGE_KEY, 'blue')
    initializeTheme()
    expect(currentTheme()).toBe('light')
  })

  it('updates on cross-tab preferences and ignores unrelated storage events', () => {
    const notify = vi.fn()
    const unsubscribe = subscribeTheme(notify)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }))
    expect(currentTheme()).toBe('dark')
    expect(notify).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'light' }))
    expect(notify).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('keeps an in-memory choice when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => setTheme('light')).not.toThrow()
    expect(currentTheme()).toBe('light')
  })

  it('resolves System correctly even when media queries are unavailable', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
