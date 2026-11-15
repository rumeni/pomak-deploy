const ACCESS = 'pomak.access'
const REFRESH = 'pomak.refresh'
// Poslednji poznati podaci o korisniku: aplikacija pokrenuta bez interneta radi sa njima.
const ME = 'pomak.me'

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
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access)
    localStorage.setItem(REFRESH, refresh)
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
  },
}
