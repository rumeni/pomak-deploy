import { api, revokePendingWebLogout } from './api'
import { tokens } from './tokens'

/**
 * Authenticate while preserving the offline-logout invariant.
 *
 * A failed asynchronous revoke must not permanently block a new login.
 * The backend replaces the refresh cookie only after validating the password
 * AND revoking any previous refresh cookie in the same request.
 */
export async function performLogin(email: string, password: string, turnstileToken?: string): Promise<void> {
  const previousLogout = tokens.pendingWebLogout()
  if (previousLogout) {
    try {
      await revokePendingWebLogout()
    } catch {
      // Login endpoint revokes the previous refresh cookie atomically before
      // writing the replacement. If its revocation fails, login fails closed.
    }
  }
  const { data } = await api.post('/auth/login/', {
    email, password, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
  })
  if (previousLogout) tokens.completeWebLogout(previousLogout)
  await tokens.set(data.access, data.refresh ?? null)
}
