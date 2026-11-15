import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import i18n, { changeLanguage, fromServerLanguage } from '../i18n'
import { api, revokePendingWebLogout, webHeaders, withAuthLock } from './api'
import { performLogin } from './login'
import { performRegistration } from './registration'
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

  // Logout may have happened offline. Retry cookie revocation after reconnect
  // and on a later launch; only a non-secret pending marker survives locally.
  useEffect(() => {
    if (!Object.keys(webHeaders()).length) return
    const retry = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      void withAuthLock(() => revokePendingWebLogout()).catch(() => undefined)
    }
    window.addEventListener('online', retry)
    retry()
    return () => window.removeEventListener('online', retry)
  }, [])

  const logout = useCallback(() => {
    const pendingRefresh = tokens.refresh()
    const access = tokens.access()
    const isWeb = Object.keys(webHeaders()).length > 0
    if (isWeb) tokens.queueWebLogout()
    // Queue cookie revocation BEFORE a possible new login takes the same lock.
    const revoke = withAuthLock(async () => {
      const refresh = await pendingRefresh
      if (isWeb) {
        await revokePendingWebLogout(refresh)
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
        await performLogin(email, password, turnstileToken)
        setHasToken(true)
      })
    },
    [],
  )

  const register = useCallback(
    async (data: RegisterData) => {
      await withAuthLock(async () => {
        await performRegistration(data)
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

