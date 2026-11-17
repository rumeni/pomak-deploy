import { isAxiosError } from 'axios'
import type { QueryClient } from '@tanstack/react-query'

/** Goal creation can also insert the first body measurement. Refresh all dependent views. */
export const GOAL_RELATED_QUERY_KEYS = ['measurements', 'goals', 'week'] as const

export function invalidateGoalRelatedQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>) {
  for (const key of GOAL_RELATED_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}

/** Duplicate create UUID with DIFFERENT user choices; inspect saved goal. */
export function goalAlreadySavedConflict(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 409
}
