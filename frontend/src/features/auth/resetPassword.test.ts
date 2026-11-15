import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('../../lib/api', () => ({ api: { post } }))

import { resetPasswordAndClearSession } from './resetPassword'

describe('password reset session invalidation', () => {
  beforeEach(() => post.mockReset())

  it('clears the revoked local session only after successful confirmation', async () => {
    const logout = vi.fn()
    post.mockResolvedValueOnce({ status: 204 })

    await resetPasswordAndClearSession('uid', 'token', 'a-new-password', logout)

    expect(post).toHaveBeenCalledWith('/auth/password/reset/confirm/', {
      uid: 'uid', token: 'token', new_password: 'a-new-password',
    })
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('does not discard a session when reset confirmation fails', async () => {
    const logout = vi.fn()
    post.mockRejectedValueOnce(new Error('expired token'))

    await expect(resetPasswordAndClearSession('uid', 'expired', 'another-password', logout))
      .rejects.toThrow('expired token')
    expect(logout).not.toHaveBeenCalled()
  })
})
