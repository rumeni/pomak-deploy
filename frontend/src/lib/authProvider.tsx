import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import i18n, { changeLanguage, fromServerLanguage, toServerLanguage, type Language } from '../i18n'
import { api, webHeaders, withAuthLock } from './api'
import { AuthContext, type RegisterData } from './authContext'
import { setCurrentUserId } from './currentUser'
import { tokens } from './tokens'
import type { Me } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [hasToken, setHasToken] = useState(() => tokens.hasSession())

  const { data: me, isLoading, isError, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<Me>('/auth/me/')).data,
    enabled: hasToken,
    // Bez interneta: poslednji poznati podaci, pa se aplikacija otvara normalno umesto
    // ekrana za prijavu. Označeni su kao stari, pa se osvežavaju čim server odgovori.
    initialData: () => (hasToken ? tokens.cachedMe<Me>() : undefined),
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (me) tokens.setCachedMe(me)
  }, [me])

  // Lokalni podaci (aktivan trening, red za slanje) pripadaju prijavljenom nalogu.
  // Postavlja se odmah pri iscrtavanju, pre nego što ekrani čitaju lokalnu bazu.
  setCurrentUserId(hasToken && me ? me.id : null)

  // Jezik sa naloga važi na svakom uređaju na kome se korisnik prijavi.
  const accountLanguage = me ? fromServerLanguage(me.profile.language) : null
  useEffect(() => {
    if (!accountLanguage || accountLanguage === i18n.language) return
    // Podaci učitani na prethodnom jeziku (nazivi vežbi, namirnica, poruke) se učitavaju ponovo.
    void changeLanguage(accountLanguage).then(() => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }))
  }, [accountLanguage, queryClient])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // Token rotation is not a login/logout: do not discard the query cache.
      if (event.key !== 'pomak.session-id') return
      queryClient.clear()
      setHasToken(tokens.hasSession())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [queryClient])

  const logout = useCallback(() => {
    const pendingRefresh = tokens.refresh()
    const access = tokens.access()
    // Queue cookie revocation BEFORE a possible new login takes the same lock.
    const revoke = withAuthLock(async () => {
      const refresh = await pendingRefresh
      if (Object.keys(webHeaders()).length) {
        // Cookie-based logout must omit possibly expired bearer credentials.
        await axios.post(`${api.defaults.baseURL}/auth/logout/`, refresh ? { refresh } : {}, {
          headers: webHeaders(), timeout: 5000,
        })
      } else if (access && refresh) {
        await axios.post(`${api.defaults.baseURL}/auth/logout/`, { refresh }, {
          headers: { Authorization: `Bearer ${access}` }, timeout: 5000,
        })
      } else if (refresh) {
        const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh/`, { refresh }, { timeout: 5000 })
        await axios.post(`${api.defaults.baseURL}/auth/logout/`, { refresh: data.refresh ?? refresh }, {
          headers: { Authorization: `Bearer ${data.access}` }, timeout: 5000,
        })
      }
    })
    void tokens.clear() // Offline local logout never awaits the network.
    setHasToken(false)
    queryClient.clear()
    void revoke.catch(() => undefined)
  }, [queryClient])

  useEffect(() => {
    window.addEventListener('pomak:logout', logout)
    return () => window.removeEventListener('pomak:logout', logout)
  }, [logout])

  const login = useCallback(
    async (email: string, password: string, turnstileToken?: string) => {
      await withAuthLock(async () => {
        const { data } = await api.post('/auth/login/', { email, password, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) })
        await tokens.set(data.access, data.refresh ?? null)
        setHasToken(true)
      })
    },
    [],
  )

  const register = useCallback(
    async ({ email, password, displayName, accountType }: RegisterData) => {
      await withAuthLock(async () => {
        const { data } = await api.post('/auth/register/', {
          email,
          password,
          display_name: displayName,
          account_type: accountType,
          language: toServerLanguage(i18n.language as Language),
        })
        if (Object.keys(webHeaders()).length) {
          // /register is intentionally legacy for older APKs. Immediately
          // exchange its one-time JSON refresh for a web-only HttpOnly cookie.
          const migrated = await axios.post(`${api.defaults.baseURL}/auth/refresh/`, {
            refresh: data.refresh,
          }, { headers: webHeaders() })
          await tokens.set(migrated.data.access, null)
        } else {
          await tokens.set(data.access, data.refresh)
        }
        setHasToken(true)
      })
    },
    [],
  )

  const retry = useCallback(() => void refetch(), [refetch])

  const value = useMemo(
    () => ({
      me: hasToken ? me : undefined,
      loading: hasToken && isLoading,
      unreachable: hasToken && !me && isError,
      retry,
      login,
      register,
      logout,
    }),
    [hasToken, me, isLoading, isError, retry, login, register, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

