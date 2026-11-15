import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

import i18n, { toServerLanguage, type Language } from '../i18n'
import { tokens } from './tokens'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8001/api' : '/api'),
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const access = tokens.access()
  if (access) config.headers.Authorization = `Bearer ${access}`
  // Server vraća poruke i nazive vežbi na jeziku aplikacije.
  config.headers['Accept-Language'] = toServerLanguage(i18n.language as Language)
  return config
})

// Više istovremenih 401 odgovora čeka isto osvežavanje tokena umesto da svaki pokrene svoje.
let refreshing: Promise<string> | null = null

async function refreshAccess(): Promise<string> {
  const refresh = tokens.refresh()
  if (!refresh) throw new Error('Nema refresh tokena')
  const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh/`, { refresh })
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
    original._retried = true
    try {
      refreshing ??= refreshAccess().finally(() => {
        refreshing = null
      })
      const access = await refreshing
      original.headers.Authorization = `Bearer ${access}`
      return api(original)
    } catch {
      tokens.clear()
      window.dispatchEvent(new Event('pomak:logout'))
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
