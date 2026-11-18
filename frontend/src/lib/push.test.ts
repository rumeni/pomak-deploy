import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userId: 'user-a' as string | null, current: true }))
const post = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ data: {} })))
const rawPost = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ data: {} })))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('./api', () => ({ api: { post, defaults: { baseURL: '/api' } }, scopeIsCurrent: () => state.current }))
vi.mock('axios', () => ({ default: { post: rawPost, isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError } }))
vi.mock('./currentUser', () => ({ getCurrentUserId: () => state.userId }))
vi.mock('./tokens', () => ({ tokens: { session: () => ({ id: 's1' }) } }))

import { applicationServerKey, enablePush, PushAborted, pushSignOut, pushStatus } from './push'
import { flushPushRemovals, pendingPushRemoval, pushRemovals } from './pushPending'

const store = new Map<string, string>()
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
}
let permission: ((value: NotificationPermission) => void) | null = null

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

  it('a registration belongs to its account: another one on this device sees it off', async () => {
    const enabling = enablePush(config)
    await vi.waitFor(() => expect(permission).not.toBeNull())
    permission!('granted')
    await expect(enabling).resolves.toBe('on')
    expect(post).toHaveBeenCalledWith('/push/devices/', expect.objectContaining({ token: subscription.endpoint }), expect.anything())
    expect(await pushStatus(config, 'user-a')).toBe('on')
    expect(await pushStatus(config, 'user-b')).toBe('off')
    // Sign-out: dropped on the device, remembered for the sign-out request to remove.
    expect(pushSignOut()).toBe(subscription.endpoint)
    expect(pendingPushRemoval()).toBe(subscription.endpoint)
    expect(await pushStatus(config, 'user-a')).toBe('off')
  })

  it('signing out while the first registration is on its way removes it once it landed', async () => {
    let answer: (value: { data: object }) => void = () => undefined
    post.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
    const enabling = enablePush(config)
    await vi.waitFor(() => expect(permission).not.toBeNull())
    permission!('granted')
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    pushSignOut()
    state.userId = 'user-b'
    await Promise.resolve()
    // Not before the registration is answered: a removal must never overtake it.
    expect(rawPost).not.toHaveBeenCalled()
    answer({ data: {} })
    await expect(enabling).rejects.toBeInstanceOf(PushAborted)
    await vi.waitFor(() => expect(rawPost).toHaveBeenCalledWith(
      '/api/push/devices/remove/', { token: subscription.endpoint, user_id: 'user-a' }, expect.anything(),
    ))
    await vi.waitFor(() => expect(pushRemovals()).toEqual([]))
    expect(await pushStatus(config, 'user-b')).toBe('off')
  })

  it('a removal that failed offline is kept and sent again later', async () => {
    const enabling = enablePush(config)
    await vi.waitFor(() => expect(permission).not.toBeNull())
    permission!('granted')
    await enabling
    rawPost.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }))
    pushSignOut()
    await vi.waitFor(() => expect(rawPost).toHaveBeenCalledTimes(1))
    await flushPushRemovals()
    expect(rawPost).toHaveBeenCalledTimes(2)
    expect(pushRemovals()).toEqual([])
  })
})
