import { describe, expect, it } from 'vitest'

import { sourceChanged } from './sourceSnapshot'

const profile = { sex: 'male' as const, birth_date: '1998-04-27', height_cm: '180.00' }
const weight = { id: 'weight-1', value: '75.00', measured_on: '2026-11-18' }

describe('long-open nutrition target form', () => {
  it('accepts the same server values despite decimal formatting', () => {
    expect(sourceChanged(profile, weight, { ...profile, height_cm: '180.0' }, { ...weight, value: '75' })).toBe(false)
  })

  it('detects a new latest measurement even when the original form had a weight', () => {
    expect(sourceChanged(profile, weight, profile, { id: 'weight-2', value: '80.00', measured_on: '2026-11-19' })).toBe(true)
    expect(sourceChanged(profile, null, profile, weight)).toBe(true)
  })

  it('detects an edited existing measurement or profile while preserving unchanged data', () => {
    expect(sourceChanged(profile, weight, profile, { ...weight, value: '80.00' })).toBe(true)
    expect(sourceChanged(profile, weight, { ...profile, height_cm: '182.00' }, weight)).toBe(true)
    expect(sourceChanged(profile, weight, { ...profile, birth_date: '1998-04-28' }, weight)).toBe(true)
    expect(sourceChanged(profile, weight, { ...profile, sex: 'female' }, weight)).toBe(true)
  })
})
