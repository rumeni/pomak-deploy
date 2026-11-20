export const THEME_STORAGE_KEY = 'pomak.theme'
export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = typeof THEMES[number]
export type ResolvedTheme = Exclude<Theme, 'system'>

let selectedTheme: Theme = 'system'
let removeListeners: (() => void) | null = null

/** Preserve an old "original" choice as Light; retire the experimental Blue palette. */
export function validTheme(value: string | null | undefined): Theme {
  if (value === 'original') return 'light'
  if (value === 'light' || value === 'dark') return value
  return 'system'
}

function readSavedTheme(): Theme {
  try { return validTheme(localStorage.getItem(THEME_STORAGE_KEY)) } catch { return 'system' }
}

function systemIsDark(): boolean {
  try { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false }
  catch { return false }
}

export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

function applyTheme(): void {
  if (typeof document === 'undefined') return
  const mode = resolveTheme(selectedTheme, systemIsDark())
  document.documentElement.dataset.pomakTheme = selectedTheme
  document.documentElement.dataset.pomakMode = mode
  document.documentElement.style.colorScheme = mode
}

function notifyTheme(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pomak:theme'))
}

/** Read persisted mode before mounting React and follow phone appearance while in System. */
export function initializeTheme(): void {
  removeListeners?.()
  selectedTheme = readSavedTheme()
  applyTheme()
  if (typeof window === 'undefined') return

  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
    selectedTheme = readSavedTheme()
    applyTheme()
    notifyTheme()
  }
  window.addEventListener('storage', onStorage)

  let media: MediaQueryList | null = null
  try { media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null }
  catch { /* Old webviews might not expose matchMedia. */ }
  const onSystemChange = () => {
    if (selectedTheme !== 'system') return
    applyTheme()
    notifyTheme()
  }
  media?.addEventListener?.('change', onSystemChange)
  removeListeners = () => {
    window.removeEventListener('storage', onStorage)
    media?.removeEventListener?.('change', onSystemChange)
  }
}

export function currentTheme(): Theme {
  return selectedTheme
}

export function setTheme(theme: Theme): void {
  selectedTheme = theme
  applyTheme()
  try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* This session still works. */ }
  notifyTheme()
}

/** React's useSyncExternalStore: the selected preference has a stable snapshot. */
export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener('pomak:theme', onChange)
  return () => window.removeEventListener('pomak:theme', onChange)
}
