import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../i18n', () => ({ default: { language: 'sr-Latn' }, toServerLanguage: () => 'sr' }))

import { api } from './api'
import { tokens } from './tokens'

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data: unknown }

/** Lažni "server": odgovara na zahteve i api i običnog axios-a (osvežavanje tokena). */
function fakeServer(handler: Handler) {
  const adapter = async (config: InternalAxiosRequestConfig) => {
    const { status, data } = handler(config)
    const response = { status, data, statusText: '', headers: new AxiosHeaders(), config }
    if (status >= 400) throw new AxiosError('fail', 'ERR', config, null, response)
    return response
  }
  api.defaults.adapter = adapter
  axios.defaults.adapter = adapter
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  tokens.set('stari', 'refresh-1')
})

afterEach(() => vi.unstubAllGlobals())

describe('osvežavanje prijave', () => {
  it('/auth/me/ posle 401 osvežava token i ponavlja zahtev (profil, jezik, obroci)', async () => {
    const seen: string[] = []
    fakeServer((config) => {
      seen.push(`${config.method} ${config.url} ${config.headers.Authorization ?? ''}`)
      if (config.url?.endsWith('/auth/refresh/')) return { status: 200, data: { access: 'novi', refresh: 'refresh-2' } }
      return config.headers.Authorization === 'Bearer novi' ? { status: 200, data: { ok: true } } : { status: 401, data: {} }
    })
    const res = await api.patch('/auth/me/', { profile: {} })
    expect(res.data).toEqual({ ok: true })
    expect(tokens.access()).toBe('novi')
    expect(seen.at(-1)).toBe('patch /auth/me/ Bearer novi')
  })

  it('kasni refresh ne moze ponovo da prijavi odjavljenog korisnika', async () => {
    let finish!: (response: { status: number; data: unknown }) => void
    const done = new Promise<{ status: number; data: unknown }>((resolve) => { finish = resolve })
    const adapter = async (config: InternalAxiosRequestConfig) => {
      const result = config.url?.endsWith('/auth/refresh/') ? await done : { status: 401, data: {} }
      const response = { ...result, statusText: '', headers: new AxiosHeaders(), config }
      if (result.status === 401) throw new AxiosError('401', 'ERR', config, null, response)
      return response
    }
    api.defaults.adapter = adapter
    axios.defaults.adapter = adapter
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
    const request = api.get('/auth/me/')
    // Wait for the failed access request to start refreshing.
    await new Promise((resolve) => setTimeout(resolve, 5))
    tokens.clear()
    finish({ status: 200, data: { access: 'late', refresh: 'late-refresh' } })
    await expect(request).rejects.toBeTruthy()
    expect(tokens.access()).toBeNull()
    expect(tokens.refresh()).toBeNull()
  })

  it('neuspela prijava (pogrešna lozinka) se ne ponavlja i ne osvežava', async () => {
    const seen: string[] = []
    fakeServer((config) => {
      seen.push(config.url ?? '')
      return { status: 401, data: { detail: 'Pogrešan email ili lozinka.' } }
    })
    await expect(api.post('/auth/login/', {})).rejects.toBeInstanceOf(AxiosError)
    expect(seen).toEqual(['/auth/login/'])
  })
})
