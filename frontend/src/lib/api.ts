import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'

import i18n, { toServerLanguage, type Language } from '../i18n'
import { tokens, type TokenSession } from './tokens'
import { getCurrentUserId } from './currentUser'

export interface AuthScope { ownerId: string; session: TokenSession }
export type ScopedRequestConfig = AxiosRequestConfig & { __pomakScope?: AuthScope }

export function scopeIsCurrent(scope: AuthScope): boolean {
  return tokens.isCurrent(scope.session) && getCurrentUserId() === scope.ownerId && tokens.userId() === scope.ownerId
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8001/api' : '/api'),
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const scoped = config as InternalAxiosRequestConfig & ScopedRequestConfig
  if (scoped.__pomakScope && !scopeIsCurrent(scoped.__pomakScope)) {
    throw new Error('Authentication changed before sending the request')
  }
  const access = tokens.access()
  if (access) config.headers.Authorization = `Bearer ${access}`
  // Server vraća poruke i nazive vežbi na jeziku aplikacije.
  config.headers['Accept-Language'] = toServerLanguage(i18n.language as Language)
  return config
})

// Više istovremenih 401 odgovora čeka isto osvežavanje tokena umesto da svaki pokrene svoje.
let refreshing: Promise<string> | null = null

async function refreshAccess(): Promise<string> {
  const session = tokens.session()
  const refresh = session.refresh
  if (!refresh) throw new Error('Nema refresh tokena')
  const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh/`, { refresh })
  if (!tokens.isCurrent(session)) throw new Error('Authentication changed during token refresh')
  tokens.set(data.access, data.refresh ?? refresh)
  return data.access
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
    // Samo prijava/registracija/osvežavanje se ne ponavljaju; /auth/me/ (profil) mora da se osveži kao i ostalo.
    const isAuthCall = ['/auth/login/', '/auth/register/', '/auth/refresh/'].includes(original?.url ?? '')
    if (error.response?.status !== 401 || !original || original._retried || isAuthCall) {
      throw error
    }
    const session = tokens.session()
    // A late 401 from another account must not refresh or invalidate today's session.
    if (original.headers.Authorization && original.headers.Authorization !== `Bearer ${tokens.access()}`) throw error
    if ((original as ScopedRequestConfig).__pomakScope && !scopeIsCurrent((original as ScopedRequestConfig).__pomakScope!)) throw error
    original._retried = true
    try {
      refreshing ??= refreshAccess().finally(() => {
        refreshing = null
      })
      const access = await refreshing
      if (tokens.access() !== access) throw new Error('Stale token refresh')
      original.headers.Authorization = `Bearer ${access}`
      return api(original)
    } catch {
      // Another tab/login may have replaced the token while this request waited.
      if (tokens.isCurrent(session)) {
        tokens.clear()
        window.dispatchEvent(new Event('pomak:logout'))
      }
      throw error
    }
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
