import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { takePendingInvite } from './workspace'

/** After login (and onboarding), a client who came from an invite link continues to it. */
export function usePendingInviteRedirect(ready: boolean) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => {
    if (!ready) return
    const code = takePendingInvite()
    if (code && !pathname.startsWith('/trener')) navigate(`/trener?kod=${code}`, { replace: true })
  }, [ready, navigate, pathname])
}
