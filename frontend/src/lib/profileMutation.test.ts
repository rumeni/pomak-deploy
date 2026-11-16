import { describe, expect, it, vi } from 'vitest'
import { acceptsProfileResponse } from './profileMutation'
import type { AuthScope } from './api'
import type { Me } from './types'

describe('account-scoped profile mutation response', () => {
  const scope = { ownerId: 'user-a', session: { id: 'login-a' } } as AuthScope
  it('accepts only a response belonging to the same account and login', () => {
    const response = { id: 'user-a' } as Me
    expect(acceptsProfileResponse(scope, response, vi.fn(() => true))).toBe(true)
    expect(acceptsProfileResponse(scope, { id: 'user-b' } as Me, vi.fn(() => true))).toBe(false)
    expect(acceptsProfileResponse(scope, response, vi.fn(() => false))).toBe(false)
  })
})
