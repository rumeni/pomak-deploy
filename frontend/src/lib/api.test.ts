import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../i18n', () => ({ default: { language: 'sr-Latn' }, toServerLanguage: () => 'sr' }))

import { api, revokePendingWebLogout, webHeaders, withAuthLock } from './api'
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
  void tokens.set('stari', null)
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
    expect(await tokens.refresh()).toBeNull()
  })

  it('paralelni zahtevi sa starim access tokenom koriste istu rotaciju', async () => {
    let finishLate401!: () => void
    const late401 = new Promise<void>((resolve) => { finishLate401 = resolve })
    let refreshCalls = 0
    const adapter = async (config: InternalAxiosRequestConfig) => {
      let status = 200
      let data: unknown = { ok: true }
      if (config.url?.endsWith('/auth/refresh/')) {
        refreshCalls += 1
        data = { access: 'novi', refresh: 'refresh-2' }
      } else {
        if (config.url === '/second/' && config.headers.Authorization === 'Bearer stari') await late401
        if (config.headers.Authorization !== 'Bearer novi') status = 401
      }
      const response = { status, data, statusText: '', headers: new AxiosHeaders(), config }
      if (status >= 400) throw new AxiosError('fail', 'ERR', config, null, response)
      return response
    }
    api.defaults.adapter = adapter
    axios.defaults.adapter = adapter
    const second = api.post('/second/', { value: 2 })
    const first = api.post('/first/', { value: 1 })
    await expect(first).resolves.toMatchObject({ data: { ok: true } })
    finishLate401()
    await expect(second).resolves.toMatchObject({ data: { ok: true } })
    expect(refreshCalls).toBe(1)
    expect(await tokens.refresh()).toBeNull()
  })

  it('rotacija ne invalidira isti login, dok ga logout i novi login invalidiraju', async () => {
    const old = tokens.session()
    expect(await tokens.rotate('novi', null, old, null)).toBe(true)
    expect(tokens.isCurrent(old)).toBe(true)
    tokens.clear()
    expect(tokens.isCurrent(old)).toBe(false)
    await tokens.set('pristup-drugog', null)
    expect(tokens.isCurrent(old)).toBe(false)
  })

  it('novi access drugog taba koristi se posle Web Lock umesto duple rotacije', async () => {
    let refreshCalls = 0
    let lockCalls = 0
    vi.stubGlobal('navigator', { locks: {
      request: async (_name: string, callback: () => Promise<string>) => {
        lockCalls += 1
        // Simulates another tab winning the lock, publishing its fresh tokens,
        // then releasing the lock for the waiting tab.
        expect(await tokens.rotate('access-iz-drugog-taba', null, tokens.session(), null)).toBe(true)
        return callback()
      },
    } })
    fakeServer((config) => {
      if (config.url?.endsWith('/auth/refresh/')) {
        refreshCalls += 1
        return { status: 200, data: { access: 'neocekivan', refresh: 'neocekivan-refresh' } }
      }
      return config.headers.Authorization === 'Bearer access-iz-drugog-taba'
        ? { status: 200, data: { ok: true } }
        : { status: 401, data: {} }
    })
    const response = await api.get('/auth/me/')
    expect(response.data).toEqual({ ok: true })
    expect(lockCalls).toBe(1)
    expect(refreshCalls).toBe(0)
    expect(tokens.access()).toBe('access-iz-drugog-taba')
  })

  it('web access/refresh JWTs nikada nisu zapisani u localStorage', async () => {
    await tokens.set('access-jwt', null)
    expect(tokens.access()).toBe('access-jwt')
    expect(localStorage.getItem('pomak.access')).toBeNull()
    expect(localStorage.getItem('pomak.refresh')).toBeNull()
    expect(tokens.hasSession()).toBe(true)
    await tokens.rotate('rotated-access', null, tokens.session(), null)
    expect(localStorage.getItem('pomak.access')).toBeNull()
    expect(localStorage.getItem('pomak.refresh')).toBeNull()
  })

  it('offline start zadržava session marker i keširan profil bez access JWT-a', async () => {
    tokens.setCachedMe({ id: 'cached-owner' })
    expect(tokens.hasSession()).toBe(true)
    // A fresh page has no access token, but still knows the cached identity.
    await tokens.rotate('online-access', null, tokens.session(), null)
    expect(tokens.cachedMe<{ id: string }>()?.id).toBe('cached-owner')
    expect(localStorage.getItem('pomak.session-id')).not.toBeNull()
  })

  it('migrira stari web refresh jednim pozivom i uklanja oba legacy JWT-a', async () => {
    localStorage.setItem('pomak.access', 'legacy-access')
    localStorage.setItem('pomak.refresh', 'legacy-refresh')
    let saw: unknown
    fakeServer((config) => {
      if (config.url?.endsWith('/auth/refresh/')) {
        saw = config.data
        expect(config.headers['X-Pomak-Client']).toBe('web')
        return { status: 200, data: { access: 'migrated-access' } }
      }
      return config.headers.Authorization === 'Bearer migrated-access'
        ? { status: 200, data: { ok: true } }
        : { status: 401, data: {} }
    })
    await api.get('/auth/me/')
    expect(saw).toContain('legacy-refresh')
    expect(localStorage.getItem('pomak.access')).toBeNull()
    expect(localStorage.getItem('pomak.refresh')).toBeNull()
  })

  it('bez Web Locks neuspešna paralelna rotacija ne odjavljuje drugi tab', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    let attempts = 0
    fakeServer((config) => {
      if (config.url?.endsWith('/auth/refresh/')) {
        attempts += 1
        if (attempts === 1) {
          // Another tab won the cookie rotation; only a non-secret epoch is shared.
          localStorage.setItem('pomak.refresh-epoch', 'other-tab-won')
          return { status: 401, data: {} }
        }
        return { status: 200, data: { access: 'recovered-access' } }
      }
      return config.headers.Authorization === 'Bearer recovered-access'
        ? { status: 200, data: { ok: true } } : { status: 401, data: {} }
    })
    const session = tokens.session()
    const response = await api.get('/auth/me/')
    expect(response.status).toBe(200)
    expect(tokens.isCurrent(session)).toBe(true)
    expect(attempts).toBe(2)
  })

  it('bez Web Locks potvrdjeno istekao cookie uklanja nevalidnu sesiju', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    let refreshCalls = 0
    fakeServer((config) => {
      if (config.url?.endsWith('/auth/refresh/')) refreshCalls += 1
      return { status: 401, data: {} }
    })
    await expect(api.get('/auth/me/')).rejects.toBeInstanceOf(AxiosError)
    expect(refreshCalls).toBe(2)
    expect(tokens.hasSession()).toBe(false)
    expect(tokens.access()).toBeNull()
  })

  it('offline logout čuva samo neosetljivi marker i opoziva cookie po povratku mreže', async () => {
    const marker = tokens.queueWebLogout()
    await tokens.clear()
    expect(tokens.pendingWebLogout()).toBe(marker)
    expect(localStorage.getItem('pomak.access')).toBeNull()
    expect(localStorage.getItem('pomak.refresh')).toBeNull()

    fakeServer(() => ({ status: 503, data: {} }))
    await expect(revokePendingWebLogout()).rejects.toBeInstanceOf(AxiosError)
    expect(tokens.pendingWebLogout()).toBe(marker)

    let revocations = 0
    fakeServer((config) => {
      expect(config.url).toContain('/auth/logout/')
      expect(config.headers['X-Pomak-Client']).toBe('web')
      expect(config.headers.Authorization).toBeUndefined()
      expect(config.data).toBe('{}')
      revocations += 1
      return { status: 204, data: null }
    })
    await revokePendingWebLogout()
    expect(revocations).toBe(1)
    expect(tokens.pendingWebLogout()).toBeNull()
    await revokePendingWebLogout()
    expect(revocations).toBe(1)
  })

  it('kasni uspešan opoziv ne briše noviju oznaku za logout', async () => {
    const first = tokens.queueWebLogout()
    let finish!: (value: { status: number; data: unknown }) => void
    const done = new Promise<{ status: number; data: unknown }>((resolve) => { finish = resolve })
    const adapter = async (config: InternalAxiosRequestConfig) => {
      const result = await done
      return { ...result, statusText: '', headers: new AxiosHeaders(), config }
    }
    axios.defaults.adapter = adapter
    const inFlight = revokePendingWebLogout()
    const second = tokens.queueWebLogout()
    finish({ status: 204, data: null })
    await inFlight
    expect(first).not.toBe(second)
    expect(tokens.pendingWebLogout()).toBe(second)
  })

  it('bez Web Locks pozadinska odjava ne može obrisati cookie nove prijave', async () => {
    vi.stubGlobal('navigator', { onLine: true }) // no navigator.locks
    tokens.queueWebLogout()
    await tokens.clear()
    let releaseLogout!: () => void
    let signalLogout!: () => void
    const blockedLogout = new Promise<void>((resolve) => { releaseLogout = resolve })
    const logoutStarted = new Promise<void>((resolve) => { signalLogout = resolve })
    let cookie: string | null = 'previous-user-cookie'
    const order: string[] = []
    axios.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url?.endsWith('/auth/logout/')) {
        order.push('logout:start')
        signalLogout()
        await blockedLogout // delayed Set-Cookie deletion from the old account
        cookie = null
        order.push('logout:end')
        return { status: 204, data: null, statusText: '', headers: new AxiosHeaders(), config }
      }
      order.push('login')
      cookie = 'new-user-cookie'
      return { status: 200, data: { access: 'new-access' }, statusText: '', headers: new AxiosHeaders(), config }
    }
    const retry = withAuthLock(() => revokePendingWebLogout())
    await logoutStarted
    const login = withAuthLock(async () => {
      await revokePendingWebLogout()
      await axios.post(`${api.defaults.baseURL}/auth/login/`, {}, { headers: webHeaders() })
      await tokens.set('new-access', null)
    })
    await Promise.resolve()
    expect(order).toEqual(['logout:start'])
    releaseLogout()
    await Promise.all([retry, login])
    expect(order).toEqual(['logout:start', 'logout:end', 'login'])
    expect(cookie).toBe('new-user-cookie')
    expect(tokens.pendingWebLogout()).toBeNull()
    expect(tokens.access()).toBe('new-access')
  })

  it('bez Web Locks neuspešna odjava ne blokira naredni auth zahtev', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    tokens.queueWebLogout()
    let calls = 0
    fakeServer(() => {
      calls += 1
      return calls === 1 ? { status: 503, data: {} } : { status: 204, data: null }
    })
    await expect(withAuthLock(() => revokePendingWebLogout())).rejects.toBeInstanceOf(AxiosError)
    expect(tokens.pendingWebLogout()).not.toBeNull()
    await withAuthLock(() => revokePendingWebLogout())
    expect(calls).toBe(2)
    expect(tokens.pendingWebLogout()).toBeNull()
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
