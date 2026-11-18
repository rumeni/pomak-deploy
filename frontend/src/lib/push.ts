/**
 * Push notifications on this device: Web Push in the browser (service worker), FCM in the
 * Android app. The user turns them on per device; signing out turns them off locally (the
 * subscription is dropped, so nothing reaches the device even if the server still lists it).
 *
 * The Android app only uses FCM when it was built with Firebase (`google-services.json` and
 * VITE_FCM_ENABLED=1): registering without Firebase would crash the app.
 */
import { Capacitor } from '@capacitor/core'

import { api } from './api'

const STORAGE = 'pomak.push.token'
const nativeEnabled = import.meta.env.VITE_FCM_ENABLED === '1'

export interface PushConfig {
  web_public_key: string | null
  fcm: boolean
}

/** unsupported: this device cannot; unavailable: the server has no push configured. */
export type PushStatus = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on'

function savedToken(): string | null {
  try {
    return localStorage.getItem(STORAGE)
  } catch {
    return null
  }
}

function saveToken(value: string | null) {
  try {
    if (value) localStorage.setItem(STORAGE, value)
    else localStorage.removeItem(STORAGE)
  } catch {
    // Private mode: the toggle shows "off" next time; harmless.
  }
}

const native = () => Capacitor.isNativePlatform()

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

export async function pushStatus(config: PushConfig): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  if (native()) {
    if (!config.fcm) return 'unavailable'
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'denied') return 'denied'
    return savedToken() ? 'on' : 'off'
  }
  if (!config.web_public_key) return 'unavailable'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  // Subscribed in this browser AND registered for this account.
  return subscription && savedToken() === subscription.endpoint ? 'on' : 'off'
}

async function nativeToken(): Promise<string | null> {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let permission = await PushNotifications.checkPermissions()
  if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions()
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

export async function enablePush(config: PushConfig): Promise<PushStatus> {
  if (native()) {
    const token = await nativeToken()
    if (!token) return 'denied'
    await api.post('/push/devices/', { kind: 'fcm', token })
    saveToken(token)
    return 'on'
  }
  if (!config.web_public_key) return 'unavailable'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.web_public_key) })
  const keys = subscription.toJSON().keys ?? {}
  await api.post('/push/devices/', { kind: 'web', token: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth })
  saveToken(subscription.endpoint)
  return 'on'
}

/** Turn push off on this device (also on sign-out): local unsubscribe first, then the server. */
export async function disablePush(): Promise<void> {
  const token = savedToken()
  saveToken(null)
  const removal = token ? api.post('/push/devices/remove/', { token }).catch(() => undefined) : Promise.resolve()
  try {
    if (native()) {
      if (nativeEnabled) {
        const { PushNotifications } = await import('@capacitor/push-notifications')
        await PushNotifications.unregister()
      }
    } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      await (await registration?.pushManager.getSubscription())?.unsubscribe()
    }
  } catch {
    // Nothing more to do locally.
  }
  await removal
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
