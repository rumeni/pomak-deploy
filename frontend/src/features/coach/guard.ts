import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { accessRegistry, dashboardAccess, guardVerdict, purgeClient, refreshCoachLists, type ServerAccess } from './access'
import { useCoachDashboard } from './api'

/** Guard a coach view of client data: purge it once access is gone, refetch once it changed. */
export function useClientGuard(clientId: string, query: { data?: { access?: ServerAccess } | null; error: unknown; isError: boolean }) {
  const qc = useQueryClient()
  const dashboard = useCoachDashboard()
  const registry = accessRegistry(qc)
  const verdict = guardVerdict(query.data?.access ?? undefined, query.isError ? query.error : null, dashboardAccess(dashboard.data, registry), registry)
  useEffect(() => {
    if (verdict.state === 'revoked') void purgeClient(qc, clientId)
    else if (verdict.state === 'stale') void refreshCoachLists(qc, clientId)
  }, [verdict.state, qc, clientId])
  return verdict
}
