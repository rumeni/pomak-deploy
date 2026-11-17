import type { Language } from '../i18n'

const PREFIX = 'pomak.language-pending'

/** Per-account non-secret preference. A logged-out user cannot overwrite B's. */
// Only used for storage failures. Never keep an in-memory duplicate of a
// successfully written key: another tab can supersede or clear that key.
const fallback = new Map<string, Language>()
const keyFor = (ownerId: string) => `${PREFIX}:${ownerId}`

export function pendingLanguage(ownerId: string): Language | null {
  const key = keyFor(ownerId)
  try {
    const saved = localStorage.getItem(key)
    if (saved === 'en' || saved === 'sr-Latn') return saved
    return fallback.get(ownerId) ?? null
  } catch {
    return fallback.get(ownerId) ?? null
  }
}

export function queueLanguage(ownerId: string, language: Language): void {
  try {
    localStorage.setItem(keyFor(ownerId), language)
    fallback.delete(ownerId)
  } catch {
    // Use volatile fallback ONLY if persistent write failed.
    fallback.set(ownerId, language)
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pomak:language-pending'))
}

export function clearPendingLanguage(ownerId: string, language: Language): void {
  if (pendingLanguage(ownerId) !== language) return
  fallback.delete(ownerId)
  try {
    localStorage.removeItem(keyFor(ownerId))
  } catch {
    // The server acknowledged it; ignore a storage-disabled environment.
  }
}

/** Account deletion must remove all owner-scoped local preferences as well. */
export function forgetLanguagePreference(ownerId: string): void {
  fallback.delete(ownerId)
  try {
    localStorage.removeItem(keyFor(ownerId))
  } catch {
    // Best effort when browser storage is unavailable.
  }
}

/** Only confirm the exact choice that was uploaded under the same login. */
export async function flushPendingLanguage<T>(
  ownerId: string,
  send: (language: Language) => Promise<T>,
  isCurrent: () => boolean,
): Promise<{ synced: boolean; data?: T }> {
  const language = pendingLanguage(ownerId)
  if (!language || !isCurrent()) return { synced: false }
  const data = await send(language)
  if (!isCurrent() || pendingLanguage(ownerId) !== language) return { synced: false }
  clearPendingLanguage(ownerId, language)
  return { synced: true, data }
}
