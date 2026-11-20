export const THEME_STORAGE_KEY = 'pomak.theme'
export const THEMES = ['original', 'light', 'blue'] as const
export type Theme = typeof THEMES[number]

export function validTheme(value: string | null | undefined): Theme {
  return value === 'light' || value === 'blue' ? value : 'original'
}

function savedTheme(): Theme {
  try { return validTheme(localStorage.getItem(THEME_STORAGE_KEY)) } catch { return 'original' }
}

export function currentTheme(): Theme {
  if (typeof document !== 'undefined') {
    const applied = document.documentElement.dataset.pomakTheme
    if (applied && THEMES.includes(applied as Theme)) return applied as Theme
  }
  return savedTheme()
}

/** Apply the persisted palette before React mounts, avoiding a theme flash. */
export function initializeTheme(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.pomakTheme = savedTheme()
  }
}

export function setTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.pomakTheme = theme
  try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* use current tab only */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pomak:theme'))
}

/** Notifies theme controls for this document AND when another browser tab changes it. */
export function subscribeTheme(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
    if (typeof document !== 'undefined') document.documentElement.dataset.pomakTheme = validTheme(event.newValue)
    onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('pomak:theme', onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pomak:theme', onChange)
  }
}
