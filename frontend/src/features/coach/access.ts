import axios from 'axios'
import type { QueryClient } from '@tanstack/react-query'

import type { CoachClientDetails } from './api'
import type { CoachTask } from './tasks'

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

/** What the dashboard says about a client's collaboration and consents. */
export interface AccessRow {
  id: string
  client: { id: string }
  share_measurements: boolean
  share_nutrition: boolean
  share_readiness?: boolean
}

/**
 * Which client data may be shown, from the client's own (possibly cached) data and the dashboard.
 *
 * The newer of the two is authoritative:
 * - dashboard unknown (never loaded, e.g. offline from the start): the last loaded client view,
 *   with the consents it was loaded under;
 * - dashboard newer and the collaboration is not on it (ended, or a different one now):
 *   nothing, and the cache is purged;
 * - dashboard newer with consents withdrawn since: those categories are hidden at once;
 * - client data newer (e.g. a client who connected after the last dashboard load): shown, and
 *   the lists are refreshed to catch up.
 */
export function viewableClient(
  detail: CoachClientDetails | undefined,
  { error, detailUpdatedAt, rows, dashboardUpdatedAt }: {
    error: unknown
    detailUpdatedAt: number
    rows: AccessRow[] | undefined
    dashboardUpdatedAt: number
  },
): { data: CoachClientDetails | null; purge: boolean; refresh: boolean } {
  if (error && isAccessRevoked(error)) return { data: null, purge: true, refresh: false }
  if (!detail || (error && !isNetworkFailure(error))) return { data: null, purge: false, refresh: false }
  if (!rows) return { data: detail, purge: false, refresh: false }
  const row = rows.find((r) => r.client.id === detail.connection.client.id)
  const dashboardNewer = dashboardUpdatedAt >= detailUpdatedAt
  if (!row || row.id !== detail.connection.id) {
    return dashboardNewer ? { data: null, purge: true, refresh: false } : { data: detail, purge: false, refresh: true }
  }
  const c = detail.connection
  const changed = row.share_measurements !== c.share_measurements || row.share_nutrition !== c.share_nutrition
    || (row.share_readiness ?? false) !== (c.share_readiness ?? false)
  return { data: dashboardNewer ? redact(detail, row) : detail, purge: false, refresh: changed }
}

/** Hides what the dashboard says is no longer shared. Never adds anything back. */
export function redact(detail: CoachClientDetails, row: AccessRow): CoachClientDetails {
  const readiness = row.share_readiness ?? false
  return {
    ...detail,
    connection: {
      ...detail.connection,
      share_measurements: row.share_measurements && detail.connection.share_measurements,
      share_nutrition: row.share_nutrition && detail.connection.share_nutrition,
      share_readiness: readiness && (detail.connection.share_readiness ?? false),
    },
    measurements: row.share_measurements ? detail.measurements : null,
    nutrition_days: row.share_nutrition ? detail.nutrition_days : null,
    goals: row.share_measurements ? detail.goals : detail.goals.filter((g) => g.kind === 'workouts_per_week'),
    recent_workouts: detail.recent_workouts.map((w) => (readiness ? w : { ...w, readiness: null })),
  }
}

/**
 * Tasks the coach may see now: when the dashboard is at least as new as the task list, no tasks
 * of a client who is no longer on it, and no readiness tasks without that consent.
 */
export function visibleTaskList(tasks: CoachTask[], rows: AccessRow[] | undefined, dashboardIsNewer: boolean): CoachTask[] {
  if (!rows || !dashboardIsNewer) return tasks
  const byClient = new Map(rows.map((r) => [r.client.id, r]))
  return tasks.filter((task) => {
    const row = byClient.get(task.client.id)
    return !!row && (task.kind !== 'low_readiness' || !!row.share_readiness)
  })
}

/** Forget everything cached about a client the coach lost access to, and refresh the lists. */
export function purgeClient(qc: QueryClient, clientId: string): Promise<unknown> {
  qc.removeQueries({ queryKey: ['coach-client', clientId] })
  qc.removeQueries({ queryKey: ['coach-messages', clientId] })
  return refreshCoachLists(qc)
}

/** The dashboard, tasks and conversations, after a confirmed change of access or consent. */
export function refreshCoachLists(qc: QueryClient, clientId?: string): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['coach-dashboard'] }),
    qc.invalidateQueries({ queryKey: ['coach-tasks'] }),
    qc.invalidateQueries({ queryKey: ['coach-conversations'] }),
    ...(clientId ? [qc.invalidateQueries({ queryKey: ['coach-client', clientId] })] : []),
  ])
}
