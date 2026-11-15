import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { Capacitor } from '@capacitor/core'

import i18n, { toServerLanguage, type Language } from '../i18n'
import { tokens, type TokenSession } from './tokens'
import { getCurrentUserId } from './currentUser'

export interface AuthScope { ownerId: string; session: TokenSession }
export type ScopedRequestConfig = AxiosRequestConfig & { __pomakScope?: AuthScope }
type AuthRequest = InternalAxiosRequestConfig & ScopedRequestConfig & { _retried?: boolean; __pomakSession?: TokenSession }

export function scopeIsCurrent(scope: AuthScope): boolean {
  return tokens.isCurrent(scope.session) && getCurrentUserId() === scope.ownerId && tokens.userId() === scope.ownerId
}

export const webHeaders = () => Capacitor.isNativePlatform() ? {} : { 'X-Pomak-Client': 'web' }

export function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return !Capacitor.isNativePlatform() && locks?.request
    ? locks.request('pomak:jwt-refresh', fn) : fn()
}

/** Call under withAuthLock: no JWT is persisted while offline logout is pending. */
export async function revokePendingWebLogout(legacyRefresh: string | null = null): Promise<void> {
  const marker = tokens.pendingWebLogout()
  if (!marker || Capacitor.isNativePlatform()) return
  await axios.post(`${api.defaults.baseURL}/auth/logout/`,
    legacyRefresh ? { refresh: legacyRefresh } : {},
    { headers: webHeaders(), timeout: 5000 },
  )
  tokens.completeWebLogout(marker)
}

export const api = axios.create({
  // Web is same-origin in development (Vite proxy) and production (Vercel rewrite).
  // Native Capacitor intentionally uses an absolute HTTPS API URL.
  baseURL: Capacitor.isNativePlatform()
    ? import.meta.env.VITE_API_URL ?? 'https://pomak-api.vercel.app/api'
    : '/api',
  timeout: 15000,
})

api.interceptors.request.use(async (config) => {
  const request = config as AuthRequest
  request.__pomakSession ??= tokens.session()
  const session = request.__pomakSession
  if (session.id && !tokens.isCurrent(session)) {
    throw new Error('Authentication changed before sending the request')
  }
  const isAuthCall = ['/auth/login/', '/auth/register/', '/auth/refresh/'].includes(request.url ?? '')
  if (!isAuthCall && session.id && !tokens.access() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    await refreshFor(session, null) // Fresh tab: bootstrap from cookie/native store before first API call.
  }
  if (session.id && !tokens.isCurrent(session)) throw new Error('Authentication changed before sending the request')
  if (request.__pomakScope && !scopeIsCurrent(request.__pomakScope)) {
    throw new Error('Authentication changed before sending the request')
  }
  const access = tokens.access()
  if (access) config.headers.Authorization = `Bearer ${access}`
  if (request.url === '/auth/login/') Object.assign(config.headers, webHeaders())
  config.headers['Accept-Language'] = toServerLanguage(i18n.language as Language)
  return config
})

// One promise per login in this tab. A different login never inherits an old
// user's in-flight refresh; navigator.locks coordinates OTHER browser tabs.
let refreshing: { id: string; promise: Promise<string> } | null = null

async function refreshAccess(session: TokenSession, rejectedAccess: string | null): Promise<string> {
  const refreshUnderLock = async (): Promise<string> => {
    if (!tokens.isCurrent(session)) throw new Error('Authentication changed during token refresh')
    const currentAccess = tokens.access()
    if (currentAccess && currentAccess !== rejectedAccess) return currentAccess
    const refresh = await tokens.refresh()
    const epoch = tokens.rotationEpoch()
    if (!tokens.isCurrent(session)) throw new Error('Authentication changed during token refresh')
    try {
      const { data } = await axios.post(
        `${api.defaults.baseURL}/auth/refresh/`,
        refresh ? { refresh } : {},
        { headers: webHeaders(), timeout: 15000 },
      )
      if (!tokens.isCurrent(session)) throw new Error('Authentication changed during token refresh')
      if (!await tokens.rotate(data.access, data.refresh ?? null, session, refresh)) {
        const newerAccess = tokens.access()
        if (newerAccess && tokens.isCurrent(session)) return newerAccess
        throw new Error('Authentication changed during token refresh')
      }
      return data.access
    } catch (error) {
      const newerAccess = tokens.access()
      if (newerAccess && newerAccess !== rejectedAccess && tokens.isCurrent(session)) return newerAccess
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      if ([400, 401, 403].includes(status ?? 0) && tokens.isCurrent(session)) {
        // Without Web Locks another tab may have rotated the cookie already.
        // A failed tab must never delete the shared login marker in that case.
        const noLocks = !Capacitor.isNativePlatform() && !(typeof navigator !== 'undefined' && navigator.locks?.request)
        if (noLocks) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          // An independently rotated cookie succeeds here; a truly expired
          // cookie rejects twice. Never clear the session on network failure.
          try {
            const retry = await axios.post(`${api.defaults.baseURL}/auth/refresh/`, {}, { headers: webHeaders(), timeout: 15000 })
            if (tokens.isCurrent(session) && await tokens.rotate(retry.data.access, null, session, null)) {
              return retry.data.access
            }
          } catch (retryError) {
            const retryStatus = axios.isAxiosError(retryError) ? retryError.response?.status : undefined
            if ([400, 401, 403].includes(retryStatus ?? 0)
              && tokens.rotationEpoch() === epoch && tokens.isCurrent(session)) {
              void tokens.clear()
              if (typeof window !== 'undefined') window.dispatchEvent(new Event('pomak:logout'))
            }
          }
        } else {
          void tokens.clear()
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('pomak:logout'))
        }
      }
      throw error
    }
  }
  return withAuthLock(refreshUnderLock)
}

function refreshFor(session: TokenSession, rejectedAccess: string | null): Promise<string> {
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
