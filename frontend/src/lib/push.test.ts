import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userId: 'user-a' as string | null, current: true }))
const post = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ data: {} })))
const rawPost = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ data: {} })))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('./api', () => ({ api: { post, defaults: { baseURL: '/api' } }, scopeIsCurrent: () => state.current }))
vi.mock('axios', () => ({ default: { post: rawPost, isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError } }))
vi.mock('./currentUser', () => ({ getCurrentUserId: () => state.userId }))
vi.mock('./tokens', () => ({ tokens: { session: () => ({ id: 's1' }) } }))

import { applicationServerKey, enablePush, PushAborted, pushSignOut, pushStatus, syncPush } from './push'
import { flushPushRemovals, legacyLogoutToken, pendingPushRemoval, pushRevocations, recoverPushRevocations } from './pushPending'

const store = new Map<string, string>()
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
}
let permission: ((value: NotificationPermission) => void) | null = null
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true })
/** The attempt sent with the n-th registration request. */
const attemptOf = (call = 0) => (post.mock.calls[call][1] as { attempt: string }).attempt
const revoked = () => rawPost.mock.calls.map((c) => c[1] as { attempt: string; user_id: string })

beforeEach(() => {
  store.clear()
  post.mockReset()
  post.mockImplementation(async () => ({ data: {} }))
  rawPost.mockReset()
  rawPost.mockImplementation(async () => ({ data: {} }))
  permission = null
  state.userId = 'user-a'
  state.current = true
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  const reg = {
    pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription },
    getNotifications: async () => [],
  }
  vi.stubGlobal('window', { PushManager: class {}, Notification: class {} })
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg } })
  vi.stubGlobal('Notification', {
    permission: 'default',
    requestPermission: () => new Promise<NotificationPermission>((resolve) => { permission = resolve }),
  })
})

const config = { web_public_key: 'BAAA', fcm: false }

async function enable() {
  const enabling = enablePush(config)
  await vi.waitFor(() => expect(permission).not.toBeNull())
  permission!('granted')
  return enabling
}

describe('push', () => {
  it('turns the server key (base64url, no padding) into the bytes the browser expects', () => {
    const bytes = new Uint8Array(65).map((_, i) => (i * 37) % 256)
    const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(Array.from(applicationServerKey(key))).toEqual(Array.from(bytes))
  })

  it('a permission answered after sign-out (and another sign-in) registers nothing', async () => {
    const enabling = enablePush(config)
    await vi.waitFor(() => expect(permission).not.toBeNull())
    pushSignOut()
    state.userId = 'user-b'
    permission!('granted')
    await expect(enabling).rejects.toBeInstanceOf(PushAborted)
    expect(post).not.toHaveBeenCalled()
    expect(await pushStatus(config, 'user-b')).toBe('off')
  })

  it('a registration belongs to its account and attempt', async () => {
    await expect(enable()).resolves.toBe('on')
    expect(post).toHaveBeenCalledWith('/push/devices/', expect.objectContaining({ token: subscription.endpoint, attempt: attemptOf() }), expect.anything())
    expect(await pushStatus(config, 'user-a')).toBe('on')
    expect(await pushStatus(config, 'user-b')).toBe('off')
    rawPost.mockRejectedValueOnce(offline())
    expect(pushSignOut()).toEqual({ push_attempt: attemptOf() }) // the sign-out request revokes this attempt
    await vi.waitFor(() => expect(rawPost).toHaveBeenCalled())
    expect(pendingPushRemoval()).toBe(attemptOf()) // offline: kept for later
    expect(await pushStatus(config, 'user-a')).toBe('off')
  })

  it('signing out while the registration is on its way revokes that attempt at once (order does not matter)', async () => {
    let answer: (value: { data: object }) => void = () => undefined
    post.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
    const enabling = enable()
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    pushSignOut()
    state.userId = 'user-b'
    // Sent before the registration is answered: the server refuses the attempt if it lands later.
    await vi.waitFor(() => expect(revoked()).toContainEqual({ attempt: attemptOf(), user_id: 'user-a' }))
    answer({ data: {} })
    await expect(enabling).rejects.toBeInstanceOf(PushAborted)
    await vi.waitFor(() => expect(pushRevocations()).toEqual([]))
    expect(await pushStatus(config, 'user-b')).toBe('off')
  })

  it('a lost answer (timeout) while still signed in revokes the attempt', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('timeout of 15000ms exceeded'), { isAxiosError: true }))
    await expect(enable()).rejects.toThrow()
    await vi.waitFor(() => expect(revoked()).toEqual([{ attempt: attemptOf(), user_id: 'user-a' }]))
    expect(await pushStatus(config, 'user-a')).toBe('off')
  })

  it('re-enabling with a revocation still pending keeps the new opt-in', async () => {
    await enable()
    const first = attemptOf(0)
    rawPost.mockRejectedValue(offline())
    pushSignOut() // offline: the revocation of the first attempt waits
    await vi.waitFor(() => expect(rawPost).toHaveBeenCalled())
    permission = null
    await expect(enable()).resolves.toBe('on') // same account again, same device token
    const second = attemptOf(1)
    expect(second).not.toBe(first)
    rawPost.mockReset()
    rawPost.mockImplementation(async () => ({ data: {} }))
    await flushPushRemovals()
    // Only the old attempt is revoked; the new one is never named, so it survives on the server.
    expect(revoked()).toEqual([{ attempt: first, user_id: 'user-a' }])
    expect(await pushStatus(config, 'user-a')).toBe('on')
    expect(pushRevocations()).toEqual([])
  })

  it('start-up recovery leaves another tab\'s fresh attempt alone and revokes an abandoned one', async () => {
    store.set('pomak.push.revocations', JSON.stringify([
      { attempt: 'fresh', ownerId: 'user-a', inflight: true, startedAt: Date.now() },
      { attempt: 'abandoned', ownerId: 'user-a', inflight: true, startedAt: Date.now() - 120_000 },
    ]))
    recoverPushRevocations(null)
    await flushPushRemovals()
    expect(revoked()).toEqual([{ attempt: 'abandoned', user_id: 'user-a' }])
    expect(pushRevocations().map((x) => x.attempt)).toEqual(['fresh'])
  })

  it('a registration from #75 (token only) is upgraded to an attempt even with the same token', async () => {
    store.set('pomak.push.device', JSON.stringify({ ownerId: 'user-a', token: subscription.endpoint }))
    await syncPush(config)
    expect(post).toHaveBeenCalledWith('/push/devices/', expect.objectContaining({ token: subscription.endpoint, attempt: attemptOf() }), expect.anything())
    expect(JSON.parse(store.get('pomak.push.device')!)).toMatchObject({ ownerId: 'user-a', attempt: attemptOf() })
    expect(pushSignOut()).toEqual({ push_attempt: attemptOf() })
  })

  it('signing out before the upgrade names the legacy token (kept for the retried web sign-out)', async () => {
    store.set('pomak.push.device', JSON.stringify({ ownerId: 'user-a', token: subscription.endpoint }))
    expect(pushSignOut()).toEqual({ push_token: subscription.endpoint })
    expect(legacyLogoutToken()).toBe(subscription.endpoint)
    await flushPushRemovals()
    expect(rawPost).not.toHaveBeenCalled() // a token is never sent without a session
    expect(await pushStatus(config, 'user-a')).toBe('off')
  })

  it('an attempt left in flight by an early restart is revoked once it is clearly abandoned', async () => {
    const now = Date.now()
    store.set('pomak.push.revocations', JSON.stringify([{ attempt: 'early', ownerId: 'user-a', inflight: true, startedAt: now }]))
    recoverPushRevocations(null, now + 5_000) // restarted 5 s later: may still be another tab's
    await flushPushRemovals(null, now + 5_000)
    expect(rawPost).not.toHaveBeenCalled()
    await flushPushRemovals(null, now + 61_000) // the app stayed open past the grace period
    expect(revoked()).toEqual([{ attempt: 'early', user_id: 'user-a' }])
    expect(pushRevocations()).toEqual([])
  })
})
