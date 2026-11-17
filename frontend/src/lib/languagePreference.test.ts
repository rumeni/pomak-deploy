import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearPendingLanguage, flushPendingLanguage, pendingLanguage, queueLanguage } from './languagePreference'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})

afterEach(() => {
  clearPendingLanguage('language-u1', 'en')
  clearPendingLanguage('language-u1', 'sr-Latn')
  clearPendingLanguage('language-u2', 'en')
  clearPendingLanguage('language-u2', 'sr-Latn')
  vi.unstubAllGlobals()
})

describe('offline profile language synchronization (#49)', () => {
  it('retains the chosen preference after a failed PATCH and retries later', async () => {
    queueLanguage('language-u1', 'en')
    const failed = vi.fn().mockRejectedValueOnce(new Error('offline'))
    await expect(flushPendingLanguage('language-u1', failed, () => true)).rejects.toThrow('offline')
    expect(pendingLanguage('language-u1')).toBe('en')
    const success = vi.fn().mockResolvedValue({ id: 'language-u1', language: 'en' })
    expect(await flushPendingLanguage('language-u1', success, () => true)).toEqual({
      synced: true, data: { id: 'language-u1', language: 'en' },
    })
    expect(pendingLanguage('language-u1')).toBeNull()
  })

  it('does not resurrect an older choice after another browser tab clears the shared key', async () => {
    queueLanguage('language-u1', 'en') // tab A
    values.set('pomak.language-pending:language-u1', 'sr-Latn') // tab B replaces it
    expect(pendingLanguage('language-u1')).toBe('sr-Latn')
    values.delete('pomak.language-pending:language-u1') // tab B syncs it
    expect(pendingLanguage('language-u1')).toBeNull()
    const send = vi.fn()
    expect((await flushPendingLanguage('language-u1', send, () => true)).synced).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('never clears a newer preference when an older PATCH returns late', async () => {
    queueLanguage('language-u1', 'en')
    let finish!: (value: string) => void
    const delayed = new Promise<string>((resolve) => { finish = resolve })
    const attempt = flushPendingLanguage('language-u1', () => delayed, () => true)
    queueLanguage('language-u1', 'sr-Latn')
    finish('old-en')
    expect((await attempt).synced).toBe(false)
    expect(pendingLanguage('language-u1')).toBe('sr-Latn')
    expect((await flushPendingLanguage('language-u1', async () => 'new-sr', () => true)).synced).toBe(true)
    expect(pendingLanguage('language-u1')).toBeNull()
  })

  it('is isolated per owner and never consumes a changed login', async () => {
    queueLanguage('language-u1', 'en')
    queueLanguage('language-u2', 'sr-Latn')
    let active = true
    const response = await flushPendingLanguage('language-u1', async () => {
      active = false
      return true
    }, () => active)
    expect(response.synced).toBe(false)
    expect(pendingLanguage('language-u1')).toBe('en')
    expect(pendingLanguage('language-u2')).toBe('sr-Latn')
    expect((await flushPendingLanguage('language-u2', async () => 1, () => true)).synced).toBe(true)
    expect(pendingLanguage('language-u1')).toBe('en')
  })
})
