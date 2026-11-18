import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import i18n, { changeLanguage, fromServerLanguage, toServerLanguage } from '../i18n'
import { disablePush } from './push'
import { api, revokePendingWebLogout, webHeaders, withAuthLock, type AuthScope, type ScopedRequestConfig } from './api'
import { performLogin } from './login'
import { performRegistration } from './registration'
import { AuthContext, type RegisterData } from './authContext'
import { getCurrentUserId, setCurrentUserId } from './currentUser'
import { flushPendingLanguage, pendingLanguage } from './languagePreference'
import { mergeProfileResponse } from './profileMutation'
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
  const ownerId = me?.id
  useEffect(() => {
    // A locally changed offline preference wins over a stale cached/server
    // profile until its PATCH is confirmed. Do not silently revert on launch.
    const preferred = ownerId ? pendingLanguage(ownerId) ?? accountLanguage : null
    if (!preferred || preferred === i18n.language) return
    void changeLanguage(preferred).then(() => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }))
  }, [accountLanguage, ownerId, queryClient])

  useEffect(() => {
    if (!hasToken || !ownerId) return
    let alive = true
    let sending = false
    const run = async () => {
      if (!alive || sending || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
      const desired = pendingLanguage(ownerId)
      if (!desired) return
      const session = tokens.session()
      const isCurrent = () => alive && getCurrentUserId() === ownerId && tokens.isCurrent(session)
      if (!isCurrent()) return
      sending = true
      try {
        const result = await flushPendingLanguage(ownerId, async (language) => {
          const scope: AuthScope = { ownerId, session }
          const requestConfig: ScopedRequestConfig = { __pomakScope: scope }
          const { data } = await api.patch<Me>('/auth/me/', {
            profile: { language: toServerLanguage(language) },
          }, requestConfig)
          return data
        }, isCurrent)
        if (result.synced && result.data && isCurrent()) {
          const serverData = result.data
          queryClient.setQueryData<Me>(['me'], (cached) => mergeProfileResponse(cached, serverData, { language: toServerLanguage(desired) }))
        }
      } catch {
        // Keep the durable preference for the next online/relaunch attempt.
      } finally {
        sending = false
        // Last selected language wins if it changed while an older PATCH was in flight.
        if (alive && pendingLanguage(ownerId) && pendingLanguage(ownerId) !== desired) void run()
      }
    }
    window.addEventListener('online', run)
    window.addEventListener('pomak:language-pending', run)
    void run()
    return () => {
      alive = false
      window.removeEventListener('online', run)
      window.removeEventListener('pomak:language-pending', run)
    }
  }, [hasToken, ownerId, queryClient])

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
    // Drop this device's push subscription first (locally at once, on the server best effort).
    void disablePush()
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

