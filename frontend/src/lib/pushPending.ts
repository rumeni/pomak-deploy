/**
 * Push registration attempts this device still has to revoke on the server, kept until it did
 * (an offline sign-out, an app closed mid-request, a registration answered after sign-out).
 *
 * Every registration is a separate attempt with a random ID made here. The server revokes
 * exactly that attempt for that account, and remembers it: a registration of a revoked attempt
 * that arrives later is refused, while a later opt-in (a new attempt, even with the same device
 * token) is never touched. So a revocation may be sent before or after its registration lands,
 * and needs no session: only this device knows the attempt ID, and the provider token is never
 * sent with it.
 */
import axios from 'axios'

const STORAGE = 'pomak.push.revocations'
/** An attempt "in flight" longer than this is abandoned (a request times out long before). */
const ABANDONED_AFTER_MS = 60_000

export interface PushRevocation {
  attempt: string
  ownerId: string
  /** The registration request may still be on its way (possibly from another tab). */
  inflight?: boolean
  startedAt?: number
}

function load(): PushRevocation[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((x): x is PushRevocation => !!x && typeof x.attempt === 'string' && typeof x.ownerId === 'string')
      : []
  } catch {
    return []
  }
}

function save(items: PushRevocation[]) {
  try {
    if (items.length) localStorage.setItem(STORAGE, JSON.stringify(items.slice(-20)))
    else localStorage.removeItem(STORAGE)
  } catch {
    // Private mode: the device unsubscribes locally anyway; the push service then reports it gone.
  }
}

const same = (a: { attempt: string; ownerId: string }, b: { attempt: string; ownerId: string }) =>
  a.attempt === b.attempt && a.ownerId === b.ownerId

export function pushRevocations(): PushRevocation[] {
  return load()
}

/** A registration request is about to be sent: revocable if it never completes for its session. */
export function startPushAttempt(item: { attempt: string; ownerId: string }) {
  save([...load().filter((x) => !same(x, item)), { ...item, inflight: true, startedAt: Date.now() }])
}

/** The attempt stays registered: nothing to revoke. */
export function keepPushAttempt(item: { attempt: string; ownerId: string }) {
  save(load().filter((x) => !same(x, item)))
}

/** Revoke this attempt (now or as soon as possible). */
export function revokePushAttempt(item: { attempt: string; ownerId: string }) {
  save([...load().filter((x) => !same(x, item)), { attempt: item.attempt, ownerId: item.ownerId }])
}

/** Sign-out: every attempt of this account still in flight is revoked too. */
export function revokeInflightAttempts(ownerId: string) {
  save(load().map((x) => (x.ownerId === ownerId ? { attempt: x.attempt, ownerId: x.ownerId } : x)))
}

/** The attempt a sign-out request can revoke right away (the authenticated path). */
export function pendingPushRemoval(ownerId?: string): string | null {
  return load().find((x) => !x.inflight && (!ownerId || x.ownerId === ownerId))?.attempt ?? null
}

/** Acknowledged by the server: only that attempt of that account. */
export function completePushRemoval(attempt: string | null, ownerId?: string) {
  if (attempt) save(load().filter((x) => !(x.attempt === attempt && (!ownerId || x.ownerId === ownerId))))
}

/**
 * At start-up: an attempt "in flight" for longer than any request can take was abandoned (the
 * app closed); a recent one may belong to another tab still registering, and is left alone.
 * One this device kept as its registration is not revoked.
 */
export function recoverPushRevocations(kept: { attempt?: string; ownerId: string } | null, now = Date.now()) {
  save(load()
    .filter((x) => !(kept?.attempt && same(x, { attempt: kept.attempt, ownerId: kept.ownerId })))
    .map((x) => (x.inflight && now - (x.startedAt ?? 0) > ABANDONED_AFTER_MS ? { attempt: x.attempt, ownerId: x.ownerId } : x)))
}

const LEGACY_LOGOUT = 'pomak.push.legacyLogout'

/**
 * A registration made before attempts existed (#75) knows only its token: the next sign-out
 * request names it (authenticated), retried with the web sign-out until it went through.
 */
export function setLegacyLogoutToken(token: string | null) {
  try {
    if (token) localStorage.setItem(LEGACY_LOGOUT, token)
    else localStorage.removeItem(LEGACY_LOGOUT)
  } catch {
    // The device unsubscribes locally anyway.
  }
}

export function legacyLogoutToken(): string | null {
  try {
    return localStorage.getItem(LEGACY_LOGOUT)
  } catch {
    return null
  }
}

/** Abandoned: still "in flight" long after any request would have ended, and not kept. */
function abandoned(x: PushRevocation, kept: { attempt?: string; ownerId: string } | null, now: number) {
  return !!x.inflight && now - (x.startedAt ?? 0) > ABANDONED_AFTER_MS && !(kept?.attempt && same(x, { attempt: kept.attempt, ownerId: kept.ownerId }))
}

let flushing: Promise<void> | null = null

/**
 * Send the pending revocations (no session needed); failures stay for the next try. Attempts
 * left "in flight" by an app closed mid-request are included once they are clearly abandoned,
 * so an early restart does not leave them pending forever.
 */
export function flushPushRemovals(kept: { attempt?: string; ownerId: string } | null = null, now = Date.now()): Promise<void> {
  flushing ??= (async () => {
    const { api } = await import('./api')
    for (const item of load().filter((x) => !x.inflight || abandoned(x, kept, now))) {
      try {
        await axios.post(`${api.defaults.baseURL}/push/devices/remove/`, { attempt: item.attempt, user_id: item.ownerId }, { timeout: 5000 })
        completePushRemoval(item.attempt, item.ownerId)
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        // A final refusal (bad input) would never succeed: drop it. Offline, 429, 5xx: try later.
        if (status && status >= 400 && status < 500 && status !== 429) completePushRemoval(item.attempt, item.ownerId)
      }
    }
  })().finally(() => { flushing = null })
  return flushing
}
