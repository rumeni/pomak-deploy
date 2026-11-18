import axios from 'axios'
import type { QueryClient } from '@tanstack/react-query'

/**
 * The server said this account may no longer see it (the collaboration ended, the role
 * changed, the session is gone). Unlike a network failure, cached data must not stay on screen.
 */
export function isAccessRevoked(error: unknown): boolean {
  if (!axios.isAxiosError(error) || !error.response) return false
  return [401, 403, 404].includes(error.response.status)
}

/** A transient failure (offline, timeout): the last loaded view may stay, marked as such. */
export function isNetworkFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response
}

/**
 * Cached client data may be shown only while it belongs to the collaboration the dashboard
 * knows as current; data of an earlier one (ended, then reconnected) never is.
 */
export function cachedClientIsCurrent(cachedConnectionId: string | undefined, activeConnectionId: string | undefined): boolean {
  return !!cachedConnectionId && (!activeConnectionId || cachedConnectionId === activeConnectionId)
}

/** Forget everything cached about a client the coach lost access to, and refresh the lists. */
export function purgeClient(qc: QueryClient, clientId: string): Promise<unknown> {
  qc.removeQueries({ queryKey: ['coach-client', clientId] })
  qc.removeQueries({ queryKey: ['coach-messages', clientId] })
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['coach-dashboard'] }),
    qc.invalidateQueries({ queryKey: ['coach-tasks'] }),
    qc.invalidateQueries({ queryKey: ['coach-conversations'] }),
  ])
}
