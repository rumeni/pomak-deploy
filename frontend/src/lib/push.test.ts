import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('./api', () => ({ api: { post: vi.fn() } }))

import { applicationServerKey, pushSupported } from './push'

describe('push', () => {
  it('turns the server key (base64url, no padding) into the bytes the browser expects', () => {
    const bytes = new Uint8Array(65).map((_, i) => (i * 37) % 256)
    const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(Array.from(applicationServerKey(key))).toEqual(Array.from(bytes))
  })

  it('is unsupported without a service worker and the Push API', () => {
    expect(pushSupported()).toBe(false)
  })
})
