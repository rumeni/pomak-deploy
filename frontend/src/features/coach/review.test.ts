import { describe, expect, it } from 'vitest'

import { describePlannedSets } from './review'

const t = (key: string, options?: Record<string, unknown>) => `${key.split('.').pop()}:${options?.count}`

describe('planned sets in a compact form', () => {
  it('groups equal working sets and counts warm-ups apart', () => {
    expect(describePlannedSets([
      { set_type: 'warmup', reps_min: 10, reps_max: 10, weight_kg: '40.00' },
      { set_type: 'working', reps_min: 8, reps_max: 10, weight_kg: '62.50', rpe: '8.0' },
      { set_type: 'working', reps_min: 8, reps_max: 10, weight_kg: '62.50', rpe: '8.0' },
      { set_type: 'working', reps_min: 6, reps_max: 6, weight_kg: '70.00' },
    ], t)).toBe('warmups:1 + 2 × 8-10 @ 62,5 kg RPE 8, 1 × 6 @ 70 kg')
  })

  it('copes with a plan the app sent without details', () => {
    expect(describePlannedSets([{}, {}], t)).toBe('sets:2')
    expect(describePlannedSets([], t)).toBe('–')
  })
})
