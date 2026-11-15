import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'

import i18n, { toServerLanguage, type Language } from '../i18n'
import { tokens, type TokenSession } from './tokens'
import { getCurrentUserId } from './currentUser'

export interface AuthScope { ownerId: string; session: TokenSession }
export type ScopedRequestConfig = AxiosRequestConfig & { __pomakScope?: AuthScope }
type AuthRequest = InternalAxiosRequestConfig & ScopedRequestConfig & { _retried?: boolean; __pomakSession?: TokenSession }

export function scopeIsCurrent(scope: AuthScope): boolean {
  return tokens.isCurrent(scope.session) && getCurrentUserId() === scope.ownerId && tokens.userId() === scope.ownerId
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8001/api' : '/api'),
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const request = config as AuthRequest
  // Capture the login identity once; a request must never be replayed under
  // another account, even if a late 401 arrives after logout and new login.
  request.__pomakSession ??= tokens.session()
  if (request.__pomakSession.id && !tokens.isCurrent(request.__pomakSession)) {
    throw new Error('Authentication changed before sending the request')
  }
  if (request.__pomakScope && !scopeIsCurrent(request.__pomakScope)) {
    throw new Error('Authentication changed before sending the request')
  }
  const access = tokens.access()
  if (access) config.headers.Authorization = `Bearer ${access}`
  config.headers['Accept-Language'] = toServerLanguage(i18n.language as Language)
  return config
})

// One promise per login in this tab. A different login never inherits an old
// user's in-flight refresh; navigator.locks coordinates OTHER browser tabs.
let refreshing: { id: string; promise: Promise<string> } | null = null

async function refreshAccess(session: TokenSession, rejectedAccess: string): Promise<string> {
  const refreshUnderLock = async (): Promise<string> => {
    if (!tokens.isCurrent(session)) throw new Error('Authentication changed during token refresh')
    // Another tab (or request) may have rotated the token while we waited for
    // the exclusive lock. Reuse its new access token instead of refreshing again.
    const currentAccess = tokens.access()
    if (currentAccess && currentAccess !== rejectedAccess) return currentAccess
    const refresh = tokens.refresh()
    if (!refresh) throw new Error('Nema refresh tokena')
    try {
      const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh/`, { refresh })
      if (!tokens.isCurrent(session)) throw new Error('Authentication changed during token refresh')
      if (!tokens.rotate(data.access, data.refresh ?? refresh, session, refresh)) {
        const newerAccess = tokens.access()
        if (newerAccess && tokens.isCurrent(session) && tokens.refresh() !== refresh) return newerAccess
        throw new Error('Authentication changed during token refresh')
      }
      return data.access
    } catch (error) {
      // If another tab already rotated successfully, consume its fresh tokens.
      const otherAccess = tokens.access()
      if (tokens.isCurrent(session) && tokens.refresh() !== refresh && otherAccess) return otherAccess
      // A temporary network/server failure should not forcibly log the user out.
      // Invalidation from a definitive auth rejection is safe while holding the
      // cross-tab lock, provided no newer tokens/session have appeared.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      if ([400, 401, 403].includes(status ?? 0) && tokens.isCurrent(session) && tokens.refresh() === refresh) {
        tokens.clear()
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('pomak:logout'))
      }
      throw error
    }
  }

  // Web Locks are supported by modern Safari/Chrome/Android WebView and are
  // scoped to all same-origin tabs. The fallback still serializes within a tab.
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return locks?.request ? locks.request('pomak:jwt-refresh', refreshUnderLock) : refreshUnderLock()
}

function refreshFor(session: TokenSession, rejectedAccess: string): Promise<string> {
  if (!session.id) return Promise.reject(new Error('No active session'))
  if (refreshing?.id === session.id) return refreshing.promise
  const promise = refreshAccess(session, rejectedAccess).finally(() => {
    if (refreshing?.promise === promise) refreshing = null
  })
  refreshing = { id: session.id, promise }
  return promise
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as AuthRequest | undefined
    const isAuthCall = ['/auth/login/', '/auth/register/', '/auth/refresh/'].includes(original?.url ?? '')
    if (error.response?.status !== 401 || !original || original._retried || isAuthCall) throw error

    const session = original.__pomakSession
    if (!session || !tokens.isCurrent(session)) throw error
    if (original.__pomakScope && !scopeIsCurrent(original.__pomakScope)) throw error
    const currentAccess = tokens.access()
    if (!currentAccess) throw error
    original._retried = true

    let access = currentAccess
    const rejectedAccess = String(original.headers.Authorization ?? '').replace(/^Bearer /, '')
    if (currentAccess === rejectedAccess) {
      try {
        access = await refreshFor(session, rejectedAccess)
      } catch {
        throw error
      }
    }
    if (!tokens.isCurrent(session) || (original.__pomakScope && !scopeIsCurrent(original.__pomakScope))) throw error
    // The request interceptor will attach the latest access token and reject
    // if the login identity changed while this handler was awaiting refresh.
    original.headers.Authorization = `Bearer ${access}`
    return api(original)
  },
)

/** Pretvara grešku sa servera u poruku za korisnika. */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return i18n.t('errors.noConnection')
    const data = error.response.data as Record<string, unknown> | undefined
    if (data && typeof data === 'object') {
      const first = Object.values(data)[0]
      if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
      if (typeof first === 'string') return first
    }
  }
  return i18n.t('errors.generic')
}
