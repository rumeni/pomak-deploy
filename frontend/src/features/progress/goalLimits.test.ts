import { describe, expect, it } from 'vitest'
import { goalRange, goalValueInRange } from './goalLimits'

describe('goal limits match the API', () => {
  it('rejects the 785 kg typo and preserves boundary weights', () => {
    expect(goalRange('weight')).toEqual([25, 350])
    expect(goalValueInRange('weight', 785)).toBe(false)
    expect(goalValueInRange('weight', 25)).toBe(true)
    expect(goalValueInRange('weight', 350)).toBe(true)
  })
  it('guards circumference and workout-target bounds', () => {
    expect(goalValueInRange('arm', 251)).toBe(false)
    expect(goalValueInRange('waist', 10)).toBe(true)
    expect(goalValueInRange('workouts_per_week', 15)).toBe(false)
  })
})
