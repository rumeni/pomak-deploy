import axios from 'axios'
import type { QueryClient } from '@tanstack/react-query'

import type { CoachClientDetails } from './api'
import type { CoachTask } from './tasks'

/**
 * What the coach may see is ordered by facts from the SERVER, never by when a response happened
 * to arrive (an older request can arrive last):
 * - `access_version` of a collaboration: +1 on every consent change and on its end;
 * - `connected_at` of a collaboration: a later one replaces an earlier one;
 * - `server_time` of the dashboard: a collaboration that began before it and is not listed
 *   as active has ended (or is gone).
 * An ended collaboration never comes back, so its ID is remembered as revoked for good.
 */

/** The server said this account may not see it. Unlike a network failure, nothing cached may stay. */
export function isAccessRevoked(error: unknown): boolean {
  if (!axios.isAxiosError(error) || !error.response) return false
  return [401, 403, 404].includes(error.response.status)
}

/** A transient failure (offline, timeout): the last loaded view may stay, marked as such. */
export function isNetworkFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response
}

/** Collaborations confirmed ended or forbidden in this session. Terminal: an ID never returns. */
const revoked = new Set<string>()

export function markRevoked(connectionId: string | undefined): void {
  if (connectionId) revoked.add(connectionId)
}

export function isRevoked(connectionId: string | undefined): boolean {
  return !!connectionId && revoked.has(connectionId)
}

/** For tests. */
export function resetRevoked(): void {
  revoked.clear()
}

/** A collaboration as the dashboard lists it. */
export interface AccessRow {
  id: string
  client: { id: string }
  share_measurements: boolean
  share_nutrition: boolean
  share_readiness?: boolean
  access_version?: number
  connected_at?: string
}

/** What one dashboard response knows. */
export interface DashboardAccess {
  rows: AccessRow[]
  archivedIds: string[]
  serverTime?: string
}

type Verdict = 'current' | 'stale' | 'unknown' | 'revoked'

const time = (iso: string | undefined) => (iso ? new Date(iso).getTime() : 0)

/**
 * Where a collaboration (seen at some access version) stands per the dashboard:
 * - 'revoked': ended, replaced by a later collaboration, or gone;
 * - 'stale': same collaboration, but its access changed since (a newer version);
 * - 'current': same collaboration and version (or older dashboard facts);
 * - 'unknown': the dashboard does not tell yet (not loaded, or older than the collaboration).
 */
export function judge(
  connection: { id: string; client_id: string; access_version?: number; connected_at?: string },
  dashboard: DashboardAccess | undefined,
): { verdict: Verdict; row?: AccessRow } {
  if (isRevoked(connection.id)) return { verdict: 'revoked' }
  if (!dashboard) return { verdict: 'unknown' }
  if (dashboard.archivedIds.includes(connection.id)) return { verdict: 'revoked' }
  const row = dashboard.rows.find((r) => r.client.id === connection.client_id)
  if (row && row.id === connection.id) {
    const seen = connection.access_version ?? 0
    return { verdict: (row.access_version ?? 0) > seen ? 'stale' : 'current', row }
  }
  if (row) {
    // A different collaboration with this client: whichever began later is the real one.
    return time(row.connected_at) > time(connection.connected_at) ? { verdict: 'revoked' } : { verdict: 'unknown' }
  }
  return dashboard.serverTime && time(dashboard.serverTime) > time(connection.connected_at)
    ? { verdict: 'revoked' }
    : { verdict: 'unknown' }
}

/**
 * Which client data may be shown.
 * - revoked (server said no, the collaboration ended or was replaced): nothing; purge the cache;
 * - stale (access changed since this data was loaded, either way): workouts only; the consent
 *   categories wait for a fresh fetch at the current version, and the cache loses whatever the
 *   current consents no longer allow;
 * - current, or unknown (e.g. offline before the dashboard ever loaded): as loaded.
 */
export function viewableClient(
  detail: CoachClientDetails | undefined,
  { error, dashboard }: { error: unknown; dashboard: DashboardAccess | undefined },
): { data: CoachClientDetails | null; purge: boolean; refresh: boolean; redactWith?: AccessRow } {
  if (error && isAccessRevoked(error)) {
    if (axios.isAxiosError(error) && error.response?.status !== 401) markRevoked(detail?.connection.id)
    return { data: null, purge: true, refresh: false }
  }
  if (!detail || (error && !isNetworkFailure(error))) return { data: null, purge: false, refresh: false }
  const c = detail.connection
  const { verdict, row } = judge({ id: c.id, client_id: c.client.id, access_version: c.access_version, connected_at: c.connected_at }, dashboard)
  if (verdict === 'revoked') {
    markRevoked(c.id)
    return { data: null, purge: true, refresh: false }
  }
  if (verdict === 'stale') return { data: withoutConsentData(detail), purge: false, refresh: true, redactWith: row }
  return { data: detail, purge: false, refresh: verdict === 'unknown' && !!dashboard }
}

/** Only what sharing workouts covers: no measurements, nutrition or readiness. */
export function withoutConsentData(detail: CoachClientDetails): CoachClientDetails {
  return {
    ...detail,
    connection: { ...detail.connection, share_measurements: false, share_nutrition: false, share_readiness: false },
    measurements: null,
    nutrition_days: null,
    goals: detail.goals.filter((g) => g.kind === 'workouts_per_week'),
    recent_workouts: detail.recent_workouts.map((w) => ({ ...w, readiness: null })),
  }
}

/** Cached client data without the categories the current consents no longer allow. */
export function redactCached(detail: CoachClientDetails, row: AccessRow): CoachClientDetails {
  return {
    ...detail,
    measurements: row.share_measurements ? detail.measurements : null,
    nutrition_days: row.share_nutrition ? detail.nutrition_days : null,
    goals: row.share_measurements ? detail.goals : detail.goals.filter((g) => g.kind === 'workouts_per_week'),
    recent_workouts: row.share_readiness ? detail.recent_workouts : detail.recent_workouts.map((w) => ({ ...w, readiness: null })),
  }
}

/**
 * Tasks the coach may see now, judged by each task's own collaboration and access version:
 * none of a revoked collaboration, and a readiness task only when it was read at the current
 * version with readiness shared.
 */
export function visibleTaskList(tasks: CoachTask[], dashboard: DashboardAccess | undefined): CoachTask[] {
  return tasks.filter((task) => {
    const c = task.connection
    if (!c) return !dashboard || dashboard.rows.some((r) => r.client.id === task.client.id)
    const { verdict, row } = judge({ id: c.id, client_id: task.client.id, access_version: c.access_version, connected_at: c.connected_at }, dashboard)
    if (verdict === 'revoked') {
      markRevoked(c.id)
      return false
    }
    if (task.kind !== 'low_readiness') return true
    if (verdict === 'stale') return false
    // Read at a newer version than the dashboard knows: the server checked consent at that version.
    if (row && c.access_version > (row.access_version ?? 0)) return true
    return verdict === 'unknown' || !!row?.share_readiness
  })
}

/** The dashboard's access facts, if it is loaded. */
export function dashboardAccess(data: unknown): DashboardAccess | undefined {
  const d = data as { role?: string; clients?: AccessRow[]; archived_clients?: { id: string }[]; server_time?: string } | undefined
  if (d?.role !== 'coach' || !d.clients) return undefined
  return { rows: d.clients, archivedIds: (d.archived_clients ?? []).map((a) => a.id), serverTime: d.server_time }
}

/** Forget everything cached about a client the coach lost access to, and refresh the lists. */
export function purgeClient(qc: QueryClient, clientId: string): Promise<unknown> {
  qc.removeQueries({ queryKey: ['coach-client', clientId] })
  qc.removeQueries({ queryKey: ['coach-messages', clientId] })
  return refreshCoachLists(qc)
}

/** The dashboard, tasks and conversations (and the client), after a confirmed change of access. */
export function refreshCoachLists(qc: QueryClient, clientId?: string): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['coach-dashboard'] }),
    qc.invalidateQueries({ queryKey: ['coach-tasks'] }),
    qc.invalidateQueries({ queryKey: ['coach-conversations'] }),
    ...(clientId ? [qc.invalidateQueries({ queryKey: ['coach-client', clientId] })] : []),
  ])
}
