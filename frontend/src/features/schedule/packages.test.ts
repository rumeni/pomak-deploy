import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))

import { packagesFor, type SessionPackage } from './api'

const pkg = { id: 'p1', name: '12', total: 12, used: 2, remaining: 10 } as SessionPackage

describe('the athlete sees only the current collaboration\'s packages', () => {
  it('shows them for the known collaboration, or while it is not known yet', () => {
    expect(packagesFor({ connection_id: 'c1', packages: [pkg] }, 'c1')).toEqual([pkg])
    expect(packagesFor({ connection_id: 'c1', packages: [pkg] }, undefined)).toEqual([pkg])
  })

  it('hides an older collaboration\'s balance after an end or a reconnect', () => {
    expect(packagesFor({ connection_id: 'c1', packages: [pkg] }, 'c2')).toEqual([])
    expect(packagesFor({ connection_id: 'c1', packages: [pkg] }, null)).toEqual([])
    expect(packagesFor(undefined, 'c1')).toEqual([])
  })
})
