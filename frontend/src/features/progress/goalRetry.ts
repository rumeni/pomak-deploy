import { isAxiosError } from 'axios'

/** Duplicate create UUID with DIFFERENT user choices; inspect saved goal. */
export function goalAlreadySavedConflict(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 409
}
