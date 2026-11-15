import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post, revokePendingWebLogout, pendingWebLogout, completeWebLogout, set } = vi.hoisted(() => ({
  post: vi.fn(),
  revokePendingWebLogout: vi.fn(),
  pendingWebLogout: vi.fn(),
  completeWebLogout: vi.fn(),
  set: vi.fn(),
}))

vi.mock('./api', () => ({ api: { post }, revokePendingWebLogout }))
vi.mock('./tokens', () => ({ tokens: { pendingWebLogout, completeWebLogout, set } }))

import { performLogin } from './login'

beforeEach(() => {
  vi.resetAllMocks()
  pendingWebLogout.mockReturnValue(null)
  post.mockResolvedValue({ data: { access: 'access', refresh: null } })
})

describe('login and offline cookie revocation', () => {
  it('does not block a new verified login when the previous logout call failed', async () => {
    pendingWebLogout.mockReturnValue('old-marker')
    revokePendingWebLogout.mockRejectedValue(new Error('offline retry timed out'))

    await performLogin('test@example.com', 'correct', 'turnstile-solution')
    expect(revokePendingWebLogout).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/auth/login/', {
      email: 'test@example.com', password: 'correct', turnstile_token: 'turnstile-solution',
    })
    expect(completeWebLogout).toHaveBeenCalledWith('old-marker')
    expect(set).toHaveBeenCalledWith('access', null)
  })

  it('never clears pending revocation or publishes a session if login itself fails', async () => {
    pendingWebLogout.mockReturnValue('old-marker')
    revokePendingWebLogout.mockRejectedValue(new Error('network'))
    post.mockRejectedValue(new Error('auth failure'))

    await expect(performLogin('test@example.com', 'wrong')).rejects.toThrow('auth failure')
    expect(completeWebLogout).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('does not revoke on an ordinary login with no pending logout', async () => {
    await performLogin('test@example.com', 'correct')
    expect(revokePendingWebLogout).not.toHaveBeenCalled()
    expect(completeWebLogout).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith('access', null)
  })
})
