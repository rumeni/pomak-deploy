import { describe, expect, it } from 'vitest'
import { canAccessAccountDeletion } from './verificationGate'

describe('unverified account routing', () => {
  it('allows signed-in users to delete before verifying or onboarding', () => {
    expect(canAccessAccountDeletion('/profil/obrisi-nalog', true)).toBe(true)
  })
  it('requires a logged-in session and does not expose other routes', () => {
    expect(canAccessAccountDeletion('/profil/obrisi-nalog', false)).toBe(false)
    for (const path of ['/danas', '/profil', '/profil/lozinka']) {
      expect(canAccessAccountDeletion(path, true)).toBe(false)
    }
  })
})
