/** The push registration a sign-out request still has to remove on the server (kept until it did). */
const PENDING_REMOVAL = 'pomak.push.pendingRemoval'

export function pendingPushRemoval(): string | null {
  try {
    return localStorage.getItem(PENDING_REMOVAL)
  } catch {
    return null
  }
}

export function setPendingPushRemoval(token: string) {
  try {
    localStorage.setItem(PENDING_REMOVAL, token)
  } catch {
    // Private mode: the device unsubscribed locally anyway.
  }
}

export function completePushRemoval(token: string | null) {
  try {
    if (token && localStorage.getItem(PENDING_REMOVAL) === token) localStorage.removeItem(PENDING_REMOVAL)
  } catch {
    // Nothing to clean up.
  }
}
