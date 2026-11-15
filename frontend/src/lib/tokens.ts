const ACCESS = 'pomak.access'
const REFRESH = 'pomak.refresh'
const SESSION = 'pomak.session-id'
// Poslednji poznati podaci o korisniku: aplikacija pokrenuta bez interneta radi sa njima.
const ME = 'pomak.me'

// Stable for one login, including every access/refresh token rotation. Changes only
// on login/logout/account switch and is shared by all tabs on the same origin.
export interface TokenSession { id: string | null }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function currentSessionId(): string | null {
  const existing = read(SESSION)
  if (existing) return existing
  // Adopt an existing login created before session IDs were introduced without
  // making users sign in again after an app upgrade.
  if (!read(ACCESS) || !read(REFRESH)) return null
  try {
    localStorage.setItem(SESSION, newId())
    return read(SESSION)
  } catch {
    return null
  }
}

export const tokens = {
  access: () => read(ACCESS),
  refresh: () => read(REFRESH),
  /** JWT subject is a sanity check; the server still validates the signature. */
  userId: (): string | null => {
    const jwt = read(ACCESS)
    if (!jwt) return null
    try {
      const payload = jwt.split('.')[1]
      if (!payload) return null
      const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { user_id?: unknown }
      return typeof data.user_id === 'string' ? data.user_id : null
    } catch {
      return null
    }
  },
  session: (): TokenSession => ({ id: currentSessionId() }),
  isCurrent: (session: TokenSession): boolean => !!session.id && session.id === currentSessionId(),
  /** A fresh login creates a new logical session, even for the same account. */
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access)
    localStorage.setItem(REFRESH, refresh)
    localStorage.removeItem(ME)
    // Publish identity last, after the new tokens exist, so other tabs do not
    // observe the previous user's credentials as part of the new login.
    localStorage.setItem(SESSION, newId())
  },
  /** Rotation is NOT a new login: never invalidate in-flight same-account work. */
  rotate(access: string, refresh: string, session: TokenSession, expectedRefresh: string): boolean {
    if (!tokens.isCurrent(session) || read(REFRESH) !== expectedRefresh) return false
    localStorage.setItem(REFRESH, refresh)
    localStorage.setItem(ACCESS, access)
    return true
  },
  cachedMe<T>(): T | undefined {
    const raw = read(ME)
    try {
      return raw ? (JSON.parse(raw) as T) : undefined
    } catch {
      return undefined
    }
  },
  setCachedMe(me: unknown) {
    try {
      localStorage.setItem(ME, JSON.stringify(me))
    } catch {
      // bez keša aplikacija i dalje radi sa internetom
    }
  },
  clear() {
    localStorage.removeItem(ACCESS)
    localStorage.removeItem(REFRESH)
    localStorage.removeItem(ME)
    localStorage.removeItem(SESSION)
  },
}
