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
 *
 * Every source (the dashboard, a client screen) reports what it saw to one access registry per
 * signed-in account (kept in the query cache, so logging out clears it). The registry keeps the
 * HIGHEST version seen per collaboration and never goes back; all screens and the task list
 * judge against it. Ended collaborations are remembered as revoked for good.
 */

/** The server said this account may not see it. Unlike a network failure, nothing cached may stay. */
export function isAccessRevoked(error: unknown): boolean {
  if (!axios.isAxiosError(error) || !error.response) return false
  // One missing thing (a deleted workout) is not a lost collaboration.
  if (isMissingResource(error)) return false
  return [401, 403, 404].includes(error.response.status)
}

/** The server says only this one item is gone (code "workout_not_found"); access is intact. */
export function isMissingResource(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 404) return false
  return (error.response.data as { code?: string } | undefined)?.code === 'workout_not_found'
}

/** A write meant for a collaboration that is no longer the active one (409 "collaboration_changed"). */
export function isCollaborationChanged(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409
    && (error.response.data as { code?: string } | undefined)?.code === 'collaboration_changed'
}

/** A transient failure (offline, timeout): the last loaded view may stay, marked as such. */
export function isNetworkFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response
}

/** Consents of a collaboration at one access version. */
export interface AccessFacts {
  id: string
  client: { id: string }
  share_measurements: boolean
  share_nutrition: boolean
  share_readiness?: boolean
  coach_sets_nutrition?: boolean
  access_version?: number
  connected_at?: string
}

/** The access facts the server sends with every coach view of client data. */
export interface ServerAccess {
  connection_id: string
  client_id: string
  access_version: number
  connected_at: string
  share_measurements: boolean
  share_nutrition: boolean
  share_readiness: boolean
  coach_sets_nutrition: boolean
}

export function factsOf(access: ServerAccess): AccessFacts {
  return {
    id: access.connection_id, client: { id: access.client_id }, access_version: access.access_version,
    connected_at: access.connected_at, share_measurements: access.share_measurements, share_nutrition: access.share_nutrition,
    share_readiness: access.share_readiness, coach_sets_nutrition: access.coach_sets_nutrition,
  }
}

/**
 * How a coach view of client data (plan, workout review, stats, target, week) may be shown,
 * judged like the client screen: by server facts, against the highest version known anywhere.
 * - 'revoked': nothing (the server said no, or the collaboration ended or was replaced);
 * - 'stale': access changed since this data was read: show no consent category until refetched;
 * - 'ok': as loaded (also offline before anything newer was seen).
 */
export function guardVerdict(
  access: ServerAccess | undefined,
  error: unknown,
  dashboard: DashboardAccess | undefined,
  registry: AccessRegistry,
): { state: 'ok' | 'stale' | 'revoked' | 'none'; known?: AccessFacts } {
  if (error && isAccessRevoked(error)) {
    if (axios.isAxiosError(error) && error.response?.status !== 401) markRevoked(registry, access?.connection_id)
    return { state: 'revoked' }
  }
  if (!access) return { state: 'none' }
  if (!error) observe(registry, factsOf(access))
  const { verdict, known } = judge(
    { id: access.connection_id, client_id: access.client_id, access_version: access.access_version, connected_at: access.connected_at },
    dashboard, registry,
  )
  if (verdict === 'revoked') return { state: 'revoked' }
  return { state: verdict === 'stale' ? 'stale' : 'ok', known }
}

/** A collaboration as the dashboard lists it. */
export type AccessRow = AccessFacts

/** What one dashboard response knows. */
export interface DashboardAccess {
  rows: AccessRow[]
  archivedIds: string[]
  serverTime?: string
}

export interface AccessRegistry {
  /** Highest version seen per collaboration, with its consents. */
  known: Map<string, AccessFacts>
  /** Ended or forbidden collaborations. Terminal: such an ID never returns. */
  revoked: Set<string>
}

const REGISTRY_KEY = ['coach-access-registry']

/** The signed-in account's registry (created on first use; cleared with the query cache on logout). */
export function accessRegistry(qc: QueryClient): AccessRegistry {
  let registry = qc.getQueryData<AccessRegistry>(REGISTRY_KEY)
  if (!registry) {
    qc.setQueryDefaults(REGISTRY_KEY, { gcTime: Infinity, staleTime: Infinity })
    registry = { known: new Map(), revoked: new Set() }
    qc.setQueryData(REGISTRY_KEY, registry)
  }
  return registry
}

/** Report what a response saw. A lower (older) version than already known is ignored. */
export function observe(registry: AccessRegistry, facts: AccessFacts): void {
  const seen = registry.known.get(facts.id)
  if (!seen || (facts.access_version ?? 0) > (seen.access_version ?? 0)) registry.known.set(facts.id, facts)
}

export function markRevoked(registry: AccessRegistry, connectionId: string | undefined): void {
  if (connectionId) registry.revoked.add(connectionId)
}

/** The dashboard's access facts (reported to the registry), if it is loaded. */
export function dashboardAccess(data: unknown, registry: AccessRegistry): DashboardAccess | undefined {
  const d = data as { role?: string; clients?: AccessRow[]; archived_clients?: { id: string }[]; server_time?: string } | undefined
  if (d?.role !== 'coach' || !d.clients) return undefined
  d.clients.forEach((row) => observe(registry, row))
  const archivedIds = (d.archived_clients ?? []).map((a) => a.id)
  archivedIds.forEach((id) => markRevoked(registry, id))
  return { rows: d.clients, archivedIds, serverTime: d.server_time }
}

type Verdict = 'current' | 'stale' | 'unknown' | 'revoked'

const time = (iso: string | undefined) => (iso ? new Date(iso).getTime() : 0)

/**
 * Where a collaboration, read at some access version, stands:
 * - 'revoked': ended, replaced by a later collaboration, or gone;
 * - 'stale': access changed since (a higher version is known): `known` holds the current consents;
 * - 'current': read at the highest known version;
 * - 'unknown': nothing newer is known (e.g. no dashboard yet, or one older than the collaboration).
 */
export function judge(
  connection: { id: string; client_id: string; access_version?: number; connected_at?: string },
  dashboard: DashboardAccess | undefined,
  registry: AccessRegistry,
): { verdict: Verdict; known?: AccessFacts } {
  if (registry.revoked.has(connection.id)) return { verdict: 'revoked' }
  if (dashboard) {
    const row = dashboard.rows.find((r) => r.client.id === connection.client_id)
    if (row && row.id !== connection.id && time(row.connected_at) > time(connection.connected_at)) {
      markRevoked(registry, connection.id)
      return { verdict: 'revoked' }
    }
    if (!row && dashboard.serverTime && time(dashboard.serverTime) > time(connection.connected_at)) {
      markRevoked(registry, connection.id)
      return { verdict: 'revoked' }
    }
  }
  const known = registry.known.get(connection.id)
  if (!known) return { verdict: 'unknown' }
  return { verdict: (known.access_version ?? 0) > (connection.access_version ?? 0) ? 'stale' : 'current', known }
}

/**
 * Which client data may be shown. The client data itself is a source too: it is reported first.
 * - revoked (server said no, the collaboration ended or was replaced): nothing; purge the cache;
 * - stale (a higher access version is known from any source): workouts only; the consent
 *   categories wait for a fresh fetch at that version, and the cache loses whatever the current
 *   consents no longer allow;
 * - current, or unknown (e.g. offline before anything newer was ever seen): as loaded.
 */
export function viewableClient(
  detail: CoachClientDetails | undefined,
  { error, dashboard, registry }: { error: unknown; dashboard: DashboardAccess | undefined; registry: AccessRegistry },
): { data: CoachClientDetails | null; purge: boolean; refresh: boolean; redactWith?: AccessFacts } {
  if (error && isAccessRevoked(error)) {
    if (axios.isAxiosError(error) && error.response?.status !== 401) markRevoked(registry, detail?.connection.id)
    return { data: null, purge: true, refresh: false }
  }
  if (!detail || (error && !isNetworkFailure(error))) return { data: null, purge: false, refresh: false }
  const c = detail.connection
  if (!error) {
    observe(registry, {
      id: c.id, client: { id: c.client.id }, share_measurements: c.share_measurements, share_nutrition: c.share_nutrition,
      share_readiness: c.share_readiness, access_version: c.access_version, connected_at: c.connected_at,
    })
  }
  const { verdict, known } = judge({ id: c.id, client_id: c.client.id, access_version: c.access_version, connected_at: c.connected_at }, dashboard, registry)
  if (verdict === 'revoked') return { data: null, purge: true, refresh: false }
  if (verdict === 'stale') return { data: withoutConsentData(detail), purge: false, refresh: true, redactWith: known }
  return { data: detail, purge: false, refresh: false }
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
export function redactCached(detail: CoachClientDetails, facts: AccessFacts): CoachClientDetails {
  return {
    ...detail,
    measurements: facts.share_measurements ? detail.measurements : null,
    nutrition_days: facts.share_nutrition ? detail.nutrition_days : null,
    goals: facts.share_measurements ? detail.goals : detail.goals.filter((g) => g.kind === 'workouts_per_week'),
    recent_workouts: facts.share_readiness ? detail.recent_workouts : detail.recent_workouts.map((w) => ({ ...w, readiness: null })),
  }
}

/**
 * Tasks the coach may see now, each judged by its own collaboration and access version against
 * the highest version known from any source: none of a revoked collaboration; a readiness task
 * only when read at (or above) the known version with readiness shared at that version.
 */
export function visibleTaskList(tasks: CoachTask[], dashboard: DashboardAccess | undefined, registry: AccessRegistry): CoachTask[] {
  return tasks.filter((task) => {
    const c = task.connection
    if (!c) return !dashboard || dashboard.rows.some((r) => r.client.id === task.client.id)
    const { verdict, known } = judge({ id: c.id, client_id: task.client.id, access_version: c.access_version, connected_at: c.connected_at }, dashboard, registry)
    if (verdict === 'revoked') return false
    if (task.kind !== 'low_readiness') return true
    if (verdict === 'stale') return false
    if (!known) return true
    // Read at a newer version than any source knows: the server checked consent at that version.
    if (c.access_version > (known.access_version ?? 0)) return true
    return !!known.share_readiness
  })
}

/** Forget everything cached about a client the coach lost access to, and refresh the lists. */
export function purgeClient(qc: QueryClient, clientId: string): Promise<unknown> {
  for (const key of ['coach-client', 'coach-messages', 'coach-client-plan', 'coach-client-workout', 'coach-client-stats',
    'coach-client-targets', 'coach-client-week']) {
    qc.removeQueries({ queryKey: [key, clientId] })
  }
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
