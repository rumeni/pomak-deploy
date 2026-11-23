import { describe, expect, it } from 'vitest'

import { formatCoachSet } from '../coach/formatCoach'
import { describeLogged, summarize, startEmpty, newActiveExercise, confirmSet } from '../workout/model'
import type { Exercise } from './api'
import { bothSides, volumeFactor } from './labels'
import { describePrescription } from './programs'

const base: Exercise = {
  id: 'bss', name: 'Bugarski čučanj', aliases: '', equipment: 'dumbbell', measurement: 'weight_reps',
  load_mode: 'total', muscle: 'legs', instructions: '', is_custom: false,
}
const unilateral = { ...base, unilateral: true }
const set = { set_type: 'working' as const, weight_kg: '20.00', reps: 10, duration_seconds: null, distance_m: null }

describe('exercises done one side at a time ("10 + 10")', () => {
  it('reps and time read for both sides; other exercises are unchanged', () => {
    expect(bothSides('10', unilateral)).toBe('10 + 10')
    expect(bothSides('10', base)).toBe('10')
    expect(bothSides('', unilateral)).toBe('')
    expect(describeLogged(set, unilateral, 'pon.')).toBe('20 × 10 + 10')
    expect(describeLogged(set, base, 'pon.')).toBe('20 × 10')
    const plank = { ...unilateral, measurement: 'duration' as const }
    expect(describeLogged({ ...set, weight_kg: null, reps: null, duration_seconds: 30 }, plank, 'pon.')).toBe('0:30 + 0:30')
    expect(formatCoachSet({ ...set, weight_kg: null }, 'Z:', 'pon.', true)).toBe('10 + 10 pon.')
  })

  it('the volume counts both sides once, also with weight per dumbbell', () => {
    expect(volumeFactor(base)).toBe(1)
    expect(volumeFactor(unilateral)).toBe(2)
    // One-arm row: one dumbbell, reps per arm - doubled once, not twice.
    expect(volumeFactor({ ...unilateral, load_mode: 'per_side' })).toBe(2)

    let w = startEmpty('T', new Date('2026-11-23T10:00:00Z'))
    const item = { ...newActiveExercise(unilateral), sets: [{ ...newActiveExercise(unilateral).sets[0], weight: '20', reps: '10' }] }
    w = { ...w, exercises: [item] }
    w = confirmSet(w, item.key, item.sets[0].key, new Date('2026-11-23T10:05:00Z'))
    expect(summarize(w, new Date('2026-11-23T10:30:00Z')).volumeKg).toBe(400)
  })

  it('a suggested program shows the per-side prescription', () => {
    const item = { exercise: unilateral, rest_seconds: 60, notes: '', sets: [{ set_type: 'working' as const, reps_min: 8, reps_max: 10, weight_kg: null, duration_seconds: null, distance_m: null }] }
    expect(describePrescription(item, 's')).toBe('1 × 8–10 + 8–10')
  })
})
