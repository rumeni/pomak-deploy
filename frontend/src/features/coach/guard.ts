import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { accessRegistry, dashboardAccess, guardVerdict, purgeClient, refreshCoachLists, type ServerAccess } from './access'
import { useCoachDashboard } from './api'

/**
 * Guard a coach view of client data: purge it once access is gone, refetch once it changed, and
 * (with `cache`) remove the consent categories from the cached data itself while it is stale.
 */
export function useClientGuard<T extends { access?: ServerAccess }>(
  clientId: string,
  query: { data?: T | null; error: unknown; isError: boolean },
  cache?: { key: readonly unknown[]; redact: (data: T) => T },
) {
  const qc = useQueryClient()
  const dashboard = useCoachDashboard()
  const registry = accessRegistry(qc)
  const verdict = guardVerdict(query.data?.access ?? undefined, query.isError ? query.error : null, dashboardAccess(dashboard.data, registry), registry)
  // The latest cache description; the effect runs when the state or the key changes.
  const cacheRef = useRef(cache)
  useEffect(() => {
    cacheRef.current = cache
  })
  const cacheKey = cache ? JSON.stringify(cache.key) : ''
  useEffect(() => {
    if (verdict.state === 'revoked') void purgeClient(qc, clientId)
    else if (verdict.state === 'stale') {
      const current = cacheRef.current
      if (current) qc.setQueryData<T>(current.key, (old) => (old ? current.redact(old) : old))
      void refreshCoachLists(qc, clientId)
    }
  }, [verdict.state, qc, clientId, cacheKey])
  return verdict
}
