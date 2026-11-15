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
