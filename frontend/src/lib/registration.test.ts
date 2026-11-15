import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  post: vi.fn(), revoke: vi.fn(), pending: vi.fn(), complete: vi.fn(),
  set: vi.fn(), webHeaders: vi.fn(), legacyRefresh: vi.fn(),
}))
vi.mock('axios', () => ({ default: { post: mocks.legacyRefresh } }))
vi.mock('../i18n', () => ({
  default: { language: 'sr-Latn' },
  toServerLanguage: () => 'sr-latn',
}))
vi.mock('./api', () => ({
  api: { post: mocks.post, defaults: { baseURL: '/api' } },
  revokePendingWebLogout: mocks.revoke, webHeaders: mocks.webHeaders,
}))
vi.mock('./tokens', () => ({
  tokens: {
    pendingWebLogout: mocks.pending,
    completeWebLogout: mocks.complete,
    set: mocks.set,
  },
}))

import { performRegistration } from './registration'

const signup = {
  email: 'new@example.com', password: 'strong-password-123',
  displayName: 'New member', accountType: 'client' as const,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.pending.mockReturnValue(null)
  mocks.webHeaders.mockReturnValue({ 'X-Pomak-Client': 'web' })
  mocks.post.mockResolvedValue({ data: { access: 'new-access' } })
})

describe('web registration after offline logout', () => {
  it('registers despite a failed stale-cookie revoke, then clears the old marker', async () => {
    mocks.pending.mockReturnValue('old-marker')
    mocks.revoke.mockRejectedValue(new Error('offline logout failed'))

    await performRegistration(signup)
    expect(mocks.revoke).toHaveBeenCalledTimes(1)
    expect(mocks.post).toHaveBeenCalledWith('/auth/register/', {
      email: signup.email, password: signup.password,
      display_name: signup.displayName, account_type: 'client',
      language: 'sr-latn',
    })
    expect(mocks.set).toHaveBeenCalledWith('new-access', null)
    expect(mocks.complete).toHaveBeenCalledWith('old-marker')
  })

  it('does not clear pending logout or publish a session when signup fails', async () => {
    mocks.pending.mockReturnValue('old-marker')
    mocks.revoke.mockRejectedValue(new Error('offline'))
    mocks.post.mockRejectedValue(new Error('registration rejected'))

    await expect(performRegistration(signup)).rejects.toThrow('registration rejected')
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('preserves old Android registration transport without a pending web logout', async () => {
    mocks.webHeaders.mockReturnValue({})
    mocks.post.mockResolvedValue({ data: { access: 'native-access', refresh: 'native-refresh' } })
    await performRegistration(signup)
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledWith('native-access', 'native-refresh')
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('supports legacy web signup API responses by migrating JSON refresh', async () => {
    mocks.post.mockResolvedValue({ data: { access: 'old-access', refresh: 'one-time-refresh' } })
    mocks.legacyRefresh.mockResolvedValue({ data: { access: 'rotated-access' } })
    await performRegistration(signup)
    expect(mocks.legacyRefresh).toHaveBeenCalledWith(
      '/api/auth/refresh/', { refresh: 'one-time-refresh' },
      { headers: { 'X-Pomak-Client': 'web' }, timeout: 15000 },
    )
    expect(mocks.set).toHaveBeenCalledWith('rotated-access', null)
  })
})
