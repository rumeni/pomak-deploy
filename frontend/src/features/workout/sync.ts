import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api, scopeIsCurrent, type AuthScope, type ScopedRequestConfig } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { diaryRequest, syncDiary } from '../diary/sync'
import { syncOutbox } from './outbox'
import { workoutQueriesAfterSync } from './syncQueries'

const SYNC_EVENT = 'pomak:sync'
const INTERVAL_MS = 60_000

/** Traži slanje reda odmah (npr. posle završenog treninga). */
export function requestSync(): void {
  window.dispatchEvent(new Event(SYNC_EVENT))
}

/**
 * Šalje sve neposlato prijavljenog korisnika (treninge i izmene dnevnika hrane): pri otvaranju
 * aplikacije, kad se vrati internet, kad se aplikacija vrati iz pozadine, na zahtev i povremeno.
 */
export function useOutboxSync(ownerId: string | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!ownerId) return
    let stopped = false

    const run = async () => {
      // Capture one logical login; refresh rotation does not change the session.
      const scope: AuthScope = { ownerId, session: tokens.session() }
      const stillCurrent = () => !stopped && scopeIsCurrent(scope)
      const scopeKey = scope.session.id ?? ''
      const requestConfig: ScopedRequestConfig = { __pomakScope: scope }
      if (!stillCurrent()) return
      const report = await syncOutbox(
        ownerId, (payload) => api.post('/training/sessions/', payload, requestConfig), stillCurrent, scopeKey,
        (id) => api.delete(`/training/sessions/${id}/`, requestConfig),
      )
      if (!stillCurrent()) return
      await Promise.all(workoutQueriesAfterSync(report).map((queryKey) => queryClient.invalidateQueries({ queryKey })))

      const changedDays = await syncDiary(ownerId, (op) => {
        const { method, url, body } = diaryRequest(op)
        return method === 'put' ? api.put(url, body, requestConfig) : api.delete(url, requestConfig)
      }, stillCurrent, scopeKey)
      if (!stillCurrent()) return
      if (changedDays.size) {
        await Promise.all([
          ...[...changedDays].map((date) => queryClient.invalidateQueries({ queryKey: ['diary', date] })),
          queryClient.invalidateQueries({ queryKey: ['recent-foods'] }),
        ])
      }
    }
    const onEvent = () => { void run().catch(() => undefined) }

    onEvent()
    window.addEventListener(SYNC_EVENT, onEvent)
    window.addEventListener('online', onEvent)
    const timer = setInterval(onEvent, INTERVAL_MS)
    const resume = Capacitor.isNativePlatform() ? App.addListener('resume', onEvent) : null

    return () => {
      stopped = true
      window.removeEventListener(SYNC_EVENT, onEvent)
      window.removeEventListener('online', onEvent)
      clearInterval(timer)
      void resume?.then((handle) => handle.remove())
    }
  }, [ownerId, queryClient])
}
