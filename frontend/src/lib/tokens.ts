import { Capacitor } from '@capacitor/core'

const ACCESS = 'pomak.access' // legacy only; never written again
const REFRESH = 'pomak.refresh' // legacy only; never written again
const SESSION = 'pomak.session-id'
const ME = 'pomak.me'
const NATIVE_REFRESH = 'pomak.refresh'
const isNative = () => Capacitor.isNativePlatform()

export interface TokenSession { id: string | null }
let accessToken: string | null = null
let sessionAccessId: string | null = null
let secureQueue = Promise.resolve()

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string) {
  localStorage.setItem(key, value)
}
function remove(key: string) {
  try { localStorage.removeItem(key) } catch { /* private browsing */ }
}
function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function currentSessionId(): string | null {
  const id = read(SESSION)
  if (id) return id
  if (!read(REFRESH)) return null
  const adopted = newId()
  write(SESSION, adopted)
  return adopted
}
async function secure<T>(fn: () => Promise<T>): Promise<T> {
  const job = secureQueue.then(fn)
  secureQueue = job.then(() => undefined, () => undefined)
  return job
}
async function nativeStorage() {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
  return SecureStorage
}
async function nativeRead() {
  return secure(async () => (await nativeStorage()).getItem(NATIVE_REFRESH))
}
async function nativeWrite(value: string | null) {
  return secure(async () => {
    const storage = await nativeStorage()
    if (value === null) await storage.removeItem(NATIVE_REFRESH)
    else await storage.setItem(NATIVE_REFRESH, value)
  })
}
function discardLegacy() {
  remove(ACCESS)
  remove(REFRESH)
}

export const tokens = {
  access: () => sessionAccessId === currentSessionId() ? accessToken : null,
  refresh: async (): Promise<string | null> => {
    if (!isNative()) return read(REFRESH) // only during one-time migration
    return (await nativeRead()) ?? read(REFRESH)
  },
  legacyRefresh: () => read(REFRESH),
  hasSession: () => !!currentSessionId(),
  /** JWT subject is a sanity check; server validates the signature. */
  userId: (): string | null => {
    const jwt = tokens.access()
    if (!jwt) return null
    try {
      const payload = jwt.split('.')[1]
      if (!payload) return null
      const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { user_id?: unknown }
      return typeof data.user_id === 'string' ? data.user_id : null
    } catch { return null }
  },
  session: (): TokenSession => ({ id: currentSessionId() }),
  isCurrent: (session: TokenSession) => !!session.id && session.id === currentSessionId(),
  async set(access: string, refresh: string | null) {
    if (isNative()) {
      if (!refresh) throw new Error('Native login requires a refresh token')
      await nativeWrite(refresh)
    }
    discardLegacy()
    remove(ME)
    const id = newId()
    accessToken = access
    sessionAccessId = id
    write(SESSION, id) // Publish identity only after native storage succeeded.
  },
  async rotate(access: string, refresh: string | null, session: TokenSession, expected: string | null): Promise<boolean> {
    if (!tokens.isCurrent(session) || await tokens.refresh() !== expected) return false
    if (isNative()) {
      if (!refresh) return false
      await nativeWrite(refresh)
    }
    if (!tokens.isCurrent(session)) return false
    discardLegacy()
    accessToken = access
    sessionAccessId = session.id
    return true
  },
  cachedMe<T>(): T | undefined {
    const raw = read(ME)
    try { return raw ? (JSON.parse(raw) as T) : undefined } catch { return undefined }
  },
  setCachedMe(me: unknown) {
    try { write(ME, JSON.stringify(me)) } catch { /* offline cache best effort */ }
  },
  clear(): Promise<void> {
    accessToken = null
    sessionAccessId = null
    discardLegacy()
    remove(ME)
    remove(SESSION)
    return isNative() ? nativeWrite(null) : Promise.resolve()
  },
}
