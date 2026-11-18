/**
 * Push registrations this device still has to remove on the server, kept until it did (an
 * offline sign-out, an app closed mid-request, a registration that finished after sign-out).
 *
 * The removal needs no session: the server deletes a device given its own token and the account
 * it was registered for (only this device knows its token). An entry is "in flight" while its
 * registration request is still on its way, so a removal can never overtake the registration
 * it is meant to undo.
 */
import axios from 'axios'

const STORAGE = 'pomak.push.removals'

export interface PushRemoval {
  token: string
  ownerId: string
  inflight?: boolean
}

function load(): PushRemoval[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((x): x is PushRemoval => !!x && typeof x.token === 'string' && typeof x.ownerId === 'string')
      : []
  } catch {
    return []
  }
}

function save(items: PushRemoval[]) {
  try {
    if (items.length) localStorage.setItem(STORAGE, JSON.stringify(items.slice(-20)))
    else localStorage.removeItem(STORAGE)
  } catch {
    // Private mode: the device unsubscribes locally anyway; the push service then reports it gone.
  }
}

const same = (a: PushRemoval, b: { token: string; ownerId: string }) => a.token === b.token && a.ownerId === b.ownerId

export function pushRemovals(): PushRemoval[] {
  return load()
}

/** Remember a registration to remove (or, `inflight`, one whose request is still on its way). */
export function addPushRemoval(item: PushRemoval) {
  save([...load().filter((x) => !same(x, item)), item])
}

/** The registration request finished: keep it for removal (`remove`) or forget it. */
export function settlePushRegistration(item: { token: string; ownerId: string }, remove: boolean) {
  const rest = load().filter((x) => !same(x, item))
  save(remove ? [...rest, { ...item, inflight: false }] : rest)
}

/** The token a sign-out request can remove right away (the authenticated path). */
export function pendingPushRemoval(ownerId?: string): string | null {
  return load().find((x) => !x.inflight && (!ownerId || x.ownerId === ownerId))?.token ?? null
}

export function completePushRemoval(token: string | null) {
  if (token) save(load().filter((x) => x.token !== token))
}

/**
 * At start-up nothing is in flight any more. A registration this device kept (the app closed
 * after saving it) stays; any other unfinished one is removed.
 */
export function recoverPushRemovals(kept: { token: string; ownerId: string } | null) {
  save(load().filter((x) => !(x.inflight && kept && same(x, kept))).map((x) => ({ ...x, inflight: false })))
}

let flushing: Promise<void> | null = null

/** Send the pending removals (no session needed); failures stay for the next try. */
export function flushPushRemovals(): Promise<void> {
  flushing ??= (async () => {
    const { api } = await import('./api')
    for (const item of load().filter((x) => !x.inflight)) {
      try {
        await axios.post(`${api.defaults.baseURL}/push/devices/remove/`, { token: item.token, user_id: item.ownerId }, { timeout: 5000 })
        completePushRemoval(item.token)
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        // A final refusal (bad input) would never succeed: drop it. Offline, 429, 5xx: try later.
        if (status && status >= 400 && status < 500 && status !== 429) completePushRemoval(item.token)
      }
    }
  })().finally(() => { flushing = null })
  return flushing
}
