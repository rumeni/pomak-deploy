import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

/** Whether the app thinks it has a connection (the same signal TanStack Query uses). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  )
}
