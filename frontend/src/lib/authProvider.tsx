import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import i18n, { changeLanguage, fromServerLanguage, toServerLanguage, type Language } from '../i18n'
import { api } from './api'
import { AuthContext, type RegisterData } from './authContext'
import { setCurrentUserId } from './currentUser'
import { tokens } from './tokens'
import type { Me } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [hasToken, setHasToken] = useState(() => {
    tokens.session() // Upgrade an existing login to a persistent cross-tab identity.
    return !!tokens.access()
  })

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
      if (event.key !== 'pomak.session-id' && !(event.key === 'pomak.access' && event.newValue === null)) return
      queryClient.clear()
      setHasToken(!!tokens.access())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [queryClient])

  const logout = useCallback(() => {
    const refresh = tokens.refresh()
    const access = tokens.access()
    // Revoke on the server if online; local logout must not wait for the network.
    if (access && refresh) {
      void axios.post(`${api.defaults.baseURL}/auth/logout/`, { refresh }, {
        headers: { Authorization: `Bearer ${access}` }, timeout: 5000,
      }).catch(() => undefined)
    }
    tokens.clear()
    setHasToken(false)
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    window.addEventListener('pomak:logout', logout)
    return () => window.removeEventListener('pomak:logout', logout)
  }, [logout])

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post('/auth/login/', { email, password })
      tokens.set(data.access, data.refresh)
      setHasToken(true)
    },
    [],
  )

  const register = useCallback(
    async ({ email, password, displayName, accountType }: RegisterData) => {
      const { data } = await api.post('/auth/register/', {
        email,
        password,
        display_name: displayName,
        account_type: accountType,
        language: toServerLanguage(i18n.language as Language),
      })
      tokens.set(data.access, data.refresh)
      setHasToken(true)
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

