import { useEffect } from 'react'

import { api } from './api'
import { pushRegisteredFor, syncPush, type PushConfig } from './push'

/** Once per signed-in account: refresh this device's push registration if it has one. */
export function usePushSync(ownerId: string | null) {
  useEffect(() => {
    if (!ownerId || !pushRegisteredFor(ownerId)) return
    let alive = true
    void api.get<PushConfig>('/push/config/').then(({ data }) => { if (alive) void syncPush(data) }).catch(() => undefined)
    return () => { alive = false }
  }, [ownerId])
}
