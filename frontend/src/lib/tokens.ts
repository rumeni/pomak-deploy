const ACCESS = 'pomak.access'
const REFRESH = 'pomak.refresh'
// Poslednji poznati podaci o korisniku: aplikacija pokrenuta bez interneta radi sa njima.
const ME = 'pomak.me'

// Changes on login, logout and token rotation invalidate in-flight async work.
let generation = 0
export interface TokenSession { generation: number; refresh: string | null }


function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
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
  session: (): TokenSession => ({ generation, refresh: read(REFRESH) }),
  isCurrent: (session: TokenSession) => session.generation === generation && session.refresh === read(REFRESH),
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access)
    localStorage.setItem(REFRESH, refresh)
    generation++
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
    generation++
  },
}
