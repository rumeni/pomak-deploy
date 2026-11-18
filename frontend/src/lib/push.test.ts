import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userId: 'user-a' as string | null, current: true }))
const post = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('./api', () => ({ api: { post }, scopeIsCurrent: () => state.current }))
vi.mock('./currentUser', () => ({ getCurrentUserId: () => state.userId }))
vi.mock('./tokens', () => ({ tokens: { session: () => ({ id: 's1' }) } }))

import { applicationServerKey, enablePush, PushAborted, pushSignOut, pushStatus } from './push'
import { pendingPushRemoval } from './pushPending'

const store = new Map<string, string>()
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
}
let permission: ((value: NotificationPermission) => void) | null = null

beforeEach(() => {
  store.clear()
  post.mockClear()
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
})
