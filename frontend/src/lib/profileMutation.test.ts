import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ api: { patch: vi.fn() }, scopeIsCurrent: vi.fn() }))
vi.mock('./tokens', () => ({ tokens: { session: vi.fn() } }))
import { acceptsProfileResponse, mergeProfileResponse } from './profileMutation'
import type { AuthScope } from './api'
import type { Me } from './types'

describe('account-scoped profile mutation response', () => {
  const scope = { ownerId: 'user-a', session: { id: 'login-a' } } as AuthScope
  it('stale full profile response cannot revert a different field', () => {
    const cached = { id: 'user-a', profile: { language: 'en', tracks_training: true } } as Me
    const response = { id: 'user-a', profile: { language: 'sr-latn', tracks_training: false } } as Me
    expect(mergeProfileResponse(cached, response, { tracks_training: false }).profile)
      .toEqual({ language: 'en', tracks_training: false })
  })

  it('accepts only a response belonging to the same account and login', () => {
    const response = { id: 'user-a' } as Me
    expect(acceptsProfileResponse(scope, response, vi.fn(() => true))).toBe(true)
    expect(acceptsProfileResponse(scope, { id: 'user-b' } as Me, vi.fn(() => true))).toBe(false)
    expect(acceptsProfileResponse(scope, response, vi.fn(() => false))).toBe(false)
  })
})
