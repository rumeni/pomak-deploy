import { Capacitor } from '@capacitor/core'

const ACCESS = 'pomak.access'
const REFRESH = 'pomak.refresh'
const SESSION = 'pomak.session-id'
// Poslednji poznati podaci o korisniku: aplikacija pokrenuta bez interneta radi sa njima.
const ME = 'pomak.me'
const EPOCH = 'pomak.refresh-epoch' // Non-secret cross-tab rotation signal.
const isNative = () => Capacitor.isNativePlatform()
let accessToken: string | null = null
let accessSession: string | null = null
let nativeQueue = Promise.resolve()

async function nativeOperation<T>(run: () => Promise<T>): Promise<T> {
  const job = nativeQueue.then(run)
  nativeQueue = job.then(() => undefined, () => undefined)
  return job
}
async function nativeRefresh(value?: string | null): Promise<string | null> {
  return nativeOperation(async () => {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    if (value === null) { await SecureStorage.removeItem('pomak.refresh'); return null }
    if (typeof value === 'string') { await SecureStorage.setItem('pomak.refresh', value); return value }
    return SecureStorage.getItem('pomak.refresh')
  })
}
function discardLegacy() {
  localStorage.removeItem(ACCESS)
  localStorage.removeItem(REFRESH)
}

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
  if (!read(REFRESH)) return null
  try {
    localStorage.setItem(SESSION, newId())
    return read(SESSION)
  } catch {
    return null
  }
}

export const tokens = {
  access: () => accessSession === currentSessionId() ? accessToken : null,
  refresh: async () => isNative() ? (await nativeRefresh()) ?? read(REFRESH) : read(REFRESH),
  hasSession: () => !!currentSessionId(),
  rotationEpoch: () => read(EPOCH),
  /** JWT subject is a sanity check; the server still validates the signature. */
  userId: (): string | null => {
    const jwt = tokens.access()
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
  /** Fresh login changes identity; rotation preserves it across requests/tabs. */
  async set(access: string, refresh: string | null) {
    const publish = () => {
      discardLegacy()
      localStorage.removeItem(ME)
      const id = newId()
      accessToken = access
      accessSession = id
      localStorage.setItem(SESSION, id)
    }
    if (!isNative()) { publish(); return }
    if (!refresh) throw new Error('Native login requires a refresh token')
    // Include the session publication in the same queue as secure writes.
    await nativeOperation(async () => {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
      await SecureStorage.setItem(REFRESH, refresh)
      publish()
    })
  },
  async rotate(access: string, refresh: string | null, session: TokenSession, expectedRefresh: string | null): Promise<boolean> {
    const publish = () => {
      discardLegacy()
      accessToken = access
      accessSession = session.id
    }
    if (!isNative()) {
      if (!tokens.isCurrent(session) || read(REFRESH) !== expectedRefresh) return false
      publish()
      localStorage.setItem(EPOCH, newId())
      return true
    }
    // Compare, write and recheck within ONE Keystore queue transaction.
    return nativeOperation(async () => {
      if (!tokens.isCurrent(session) || !refresh) return false
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
      const stored = (await SecureStorage.getItem(REFRESH)) ?? read(REFRESH)
      if (!tokens.isCurrent(session) || stored !== expectedRefresh) return false
      await SecureStorage.setItem(REFRESH, refresh)
      if (!tokens.isCurrent(session)) {
        await SecureStorage.removeItem(REFRESH)
        return false
      }
      publish()
      return true
    })
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
  clear(): Promise<void> {
    accessToken = null
    accessSession = null
    discardLegacy()
    localStorage.removeItem(ME)
    localStorage.removeItem(SESSION)
    return isNative() ? nativeRefresh(null).then(() => undefined) : Promise.resolve()
  },
}
