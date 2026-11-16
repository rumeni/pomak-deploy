import { api } from '../../lib/api'

/** A successful reset revokes the current JWT session server-side.
 * Clear all locally cached auth state before offering the sign-in link.
 * On failure, preserve the existing session and surface the error.
 */
export async function resetPasswordAndClearSession(
  uid: string,
  token: string,
  newPassword: string,
  logout: () => void,
): Promise<void> {
  await api.post('/auth/password/reset/confirm/', {
    uid,
    token,
    new_password: newPassword,
  })
  logout()
}
