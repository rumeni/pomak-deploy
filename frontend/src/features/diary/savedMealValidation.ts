import { isAxiosError } from 'axios'

/** Mirror backend SavedMealSerializer limits and fail before the online-only POST. */
export const MAX_SAVED_MEAL_NAME_LENGTH = 100
export const MAX_SAVED_MEAL_ITEMS = 30

export type SavedMealDraftIssue = 'nameTooLong' | 'tooManyItems' | null

/** 409 means a previous attempt already committed with different contents. */
export function savedMealConflict(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 409
}

/** Preserve one create-attempt UUID until a real success response is received. */
export function withRetryMealId<T>(pendingId: string | null, freshId: string, name: string, items: T[]) {
  return { id: pendingId ?? freshId, name, items }
}

export function savedMealDraftIssue(name: string, itemCount: number): SavedMealDraftIssue {
  // Python's len() counts Unicode code points; JS string.length counts UTF-16 units.
  if ([...name].length > MAX_SAVED_MEAL_NAME_LENGTH) return 'nameTooLong'
  if (itemCount > MAX_SAVED_MEAL_ITEMS) return 'tooManyItems'
  return null
}
