/**
 * Push notifications on this device: Web Push in the browser (service worker), FCM in the
 * Android app. The user turns them on per device, for his own account.
 *
 * - Every enable/disable runs one at a time, bound to the session that started it: a permission
 *   prompt answered after sign-out (or after another account signed in) registers nothing.
 * - What this device registered is remembered with its owner; another account on the same
 *   device sees push as "off" until it turns it on for itself.
 * - Signing out drops the subscription on the device at once, clears shown notifications and
 *   removes the registration on the server through the (retried) sign-out request.
 *
 * The Android app only uses FCM when it was built with Firebase (`google-services.json` and
 * VITE_FCM_ENABLED=1): registering without Firebase would crash the app.
 */
import { Capacitor } from '@capacitor/core'

import { api, scopeIsCurrent, type AuthScope, type ScopedRequestConfig } from './api'
import { getCurrentUserId } from './currentUser'
import {
  flushPushRemovals, keepPushAttempt, pendingPushRemoval, recoverPushRevocations, revokeInflightAttempts, revokePushAttempt,
  setLegacyLogoutToken, startPushAttempt,
} from './pushPending'
import { uuid } from './uuid'
import { tokens } from './tokens'

const STORAGE = 'pomak.push.device'
const nativeEnabled = import.meta.env.VITE_FCM_ENABLED === '1'

export interface PushConfig {
  web_public_key: string | null
  fcm: boolean
}

/** unsupported: this device cannot; unavailable: the server has no push configured. */
export type PushStatus = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on'

/** What this device registered: for whom, its token, and the attempt that registered it. */
interface Registration { ownerId: string; token: string; attempt?: string }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Private mode: nothing is remembered; the toggle simply shows "off" next time.
  }
}

function registration(): Registration | null {
  try {
    const value = JSON.parse(read(STORAGE) ?? 'null') as Registration | null
    return value && typeof value.ownerId === 'string' && typeof value.token === 'string' ? value : null
  } catch {
    return null
  }
}

const native = () => Capacitor.isNativePlatform()

/** The current session, to bind an operation (and its requests) to it. */
export function currentScope(): AuthScope | null {
  const ownerId = getCurrentUserId()
  return ownerId ? { ownerId, session: tokens.session() } : null
}

// One operation at a time; sign-out bumps the epoch so a running one stops at its next step.
let queue: Promise<unknown> = Promise.resolve()
let epoch = 0

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation)
  queue = run.catch(() => undefined)
  return run
}

export class PushAborted extends Error {}

function guard(scope: AuthScope, started: number) {
  if (started !== epoch || !scopeIsCurrent(scope)) throw new PushAborted('The session changed.')
}

export function pushSupported(): boolean {
  if (native()) return nativeEnabled
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** The server key as the bytes PushManager.subscribe expects. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function webSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function pushStatus(config: PushConfig, ownerId: string): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  const mine = registration()?.ownerId === ownerId ? registration() : null
  if (native()) {
    if (!config.fcm) return 'unavailable'
    const { PushNotifications } = await import('@capacitor/push-notifications')
    if ((await PushNotifications.checkPermissions()).receive === 'denied') return 'denied'
    return mine ? 'on' : 'off'
  }
  if (!config.web_public_key) return 'unavailable'
  if (Notification.permission === 'denied') return 'denied'
  const subscription = await webSubscription()
  return subscription && mine?.token === subscription.endpoint ? 'on' : 'off'
}

async function nativeToken(check: () => void): Promise<string | null> {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let permission = await PushNotifications.checkPermissions()
  if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions()
  check()
  if (permission.receive !== 'granted') return null
  const handles: { remove: () => Promise<void> }[] = []
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('push registration timed out')), 15000)
      void PushNotifications.addListener('registration', (token) => { clearTimeout(timer); resolve(token.value) }).then((h) => handles.push(h))
      void PushNotifications.addListener('registrationError', (e) => { clearTimeout(timer); reject(new Error(e.error)) }).then((h) => handles.push(h))
      void PushNotifications.register()
    })
  } finally {
    await Promise.all(handles.map((h) => h.remove()))
  }
}

async function register(scope: AuthScope, body: Record<string, unknown>, token: string, check: () => void) {
  const config: ScopedRequestConfig = { __pomakScope: scope }
  // A new attempt each time: the server revokes attempts, never "this token" in general.
  const item = { attempt: uuid(), ownerId: scope.ownerId }
  startPushAttempt(item)
  try {
    await api.post('/push/devices/', { ...body, attempt: item.attempt }, config)
    check()
  } catch (error) {
    // Signed out, another account, refused, or an unknown outcome (a lost answer): revoke this
    // attempt. The server refuses it if it lands later, so the order does not matter.
    revokePushAttempt(item)
    void flushPush()
    throw error
  }
  const previous = registration()
  write(STORAGE, JSON.stringify({ ownerId: scope.ownerId, token, attempt: item.attempt } satisfies Registration))
  keepPushAttempt(item)
  // The attempt this one replaces (a rotated token or a renewed subscription) is revoked.
  if (previous?.attempt && previous.ownerId === scope.ownerId && previous.attempt !== item.attempt) {
    revokePushAttempt({ attempt: previous.attempt, ownerId: previous.ownerId })
    void flushPush()
  }
}

export function enablePush(config: PushConfig): Promise<PushStatus> {
  const scope = currentScope()
  const started = epoch
  return serial(async () => {
    if (!scope) throw new PushAborted('Not signed in.')
    const check = () => guard(scope, started)
    check()
    if (native()) {
      const token = await nativeToken(check)
      if (!token) return 'denied'
      check()
      await register(scope, { kind: 'fcm', token }, token, check)
      return 'on'
    }
    if (!config.web_public_key) return 'unavailable'
    const permission = await Notification.requestPermission()
    check()
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.getSubscription()
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.web_public_key) })
    check()
    const keys = subscription.toJSON().keys ?? {}
    await register(scope, { kind: 'web', token: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth }, subscription.endpoint, check)
    return 'on'
  })
}

/**
 * Turn push off on this device for the signed-in account: the server registration first (so a
 * failure leaves it visibly on), then the local subscription.
 */
export function disablePush(): Promise<PushStatus> {
  const scope = currentScope()
  const started = epoch
  return serial(async () => {
    if (!scope) throw new PushAborted('Not signed in.')
    guard(scope, started)
    const mine = registration()
    if (mine && mine.ownerId === scope.ownerId) {
      const config: ScopedRequestConfig = { __pomakScope: scope }
      await api.post('/push/devices/remove/', mine.attempt ? { attempt: mine.attempt } : { token: mine.token }, config)
    }
    write(STORAGE, null)
    await unsubscribeLocally()
    return 'off' as PushStatus
  })
}

async function unsubscribeLocally() {
  try {
    if (native()) {
      if (!nativeEnabled) return
      const { PushNotifications } = await import('@capacitor/push-notifications')
      await PushNotifications.unregister()
      await PushNotifications.removeAllDeliveredNotifications()
    } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      await (await reg?.pushManager.getSubscription())?.unsubscribe()
      for (const shown of (await reg?.getNotifications()) ?? []) shown.close()
    }
  } catch {
    // The push service will report the subscription as gone; the server then removes it.
  }
}

/**
 * Sign-out: stop any running enable, drop the subscription on the device right away, and
 * return the token the sign-out request should remove on the server (remembered until it did).
 * Notifications already handed to the system before this may still appear.
 */
/** What the sign-out request names: the attempt, or the token of a not yet upgraded registration. */
export interface PushSignOutBody { push_attempt?: string; push_token?: string }

export function pushSignOut(): PushSignOutBody {
  epoch += 1
  const mine = registration()
  write(STORAGE, null)
  if (mine?.attempt) revokePushAttempt({ attempt: mine.attempt, ownerId: mine.ownerId })
  // A registration from before attempts (#75): only the authenticated sign-out can remove it
  // (by token, legacy rows only); on the web that request is retried until it went through.
  const legacy = mine && !mine.attempt ? mine.token : null
  if (legacy) setLegacyLogoutToken(legacy)
  // A registration of this account still on its way is revoked as well (refused if it lands).
  const ownerId = mine?.ownerId ?? getCurrentUserId()
  if (ownerId) revokeInflightAttempts(ownerId)
  void serial(unsubscribeLocally)
  // Also without a session or network: retried at start-up and when the device is online again.
  void flushPush()
  const attempt = mine?.attempt ?? pendingPushRemoval(ownerId ?? undefined)
  return { ...(attempt ? { push_attempt: attempt } : {}), ...(legacy ? { push_token: legacy } : {}) }
}

/** Revocations with the current registration kept (it is never revoked by recovery). */
function flushPush(now = Date.now()) {
  return flushPushRemovals(registration(), now)
}

/** At start-up: finish removals left by an offline sign-out or a closed app, and retry online. */
export function startPushRecovery() {
  recoverPushRevocations(registration())
  void flushPush()
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => void flushPush())
    // An attempt left "in flight" by an early restart becomes revocable after the grace period.
    setTimeout(() => void flushPush(), 61_000)
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flushPush() })
  }
}

/**
 * After sign-in: keep this account's registration current (a browser can renew its subscription,
 * FCM can rotate its token), or forget it if the device no longer has it.
 */
export function syncPush(config: PushConfig): Promise<void> {
  const scope = currentScope()
  const started = epoch
  return serial(async () => {
    const mine = registration()
    if (!scope || !mine || mine.ownerId !== scope.ownerId || !pushSupported()) return
    const check = () => guard(scope, started)
    if (native()) {
      if (!config.fcm) return
      const { PushNotifications } = await import('@capacitor/push-notifications')
      if ((await PushNotifications.checkPermissions()).receive !== 'granted') return
      const token = await nativeToken(check)
      // A new token, or a registration from before attempts: registered again with an attempt.
      if (token && (token !== mine.token || !mine.attempt)) await register(scope, { kind: 'fcm', token }, token, check)
      return
    }
    const subscription = await webSubscription()
    check()
    if (!subscription) {
      write(STORAGE, null)
      return
    }
    // A renewed subscription, or a registration from before attempts (#75): registered again with
    // an attempt, so it can be revoked later like any other.
    if (subscription.endpoint !== mine.token || !mine.attempt) {
      const keys = subscription.toJSON().keys ?? {}
      await register(scope, { kind: 'web', token: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth }, subscription.endpoint, check)
    }
  }).catch(() => undefined)
}

/** Whether this device registered push for that account (cheap, local). */
export function pushRegisteredFor(ownerId: string): boolean {
  return pushSupported() && registration()?.ownerId === ownerId
}

/** Android: a tapped notification opens its screen. */
export async function listenForNativePushTaps(): Promise<void> {
  if (!native() || !nativeEnabled) return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      window.history.pushState({}, '', url)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  })
}
