import { describe, expect, it } from 'vitest'

import type { Exercise } from './api'
import { describePrescription, programToRoutines, type Program } from './programs'

const bench: Exercise = {
  id: 'e-bench', slug: 'bench-press', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
  load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
}
const plank: Exercise = { ...bench, id: 'e-plank', slug: 'plank', measurement: 'duration', muscle: 'core' }
const set = { set_type: 'working' as const, reps_min: 8, reps_max: 10, weight_kg: null, duration_seconds: null, distance_m: null, rpe: '6.5' }

const program: Program = {
  key: 'full-body-beginner', sex: 'male', level: 'beginner', days: 3, recommended: true,
  name: 'Celo telo za početnike', description: '',
  routines: [
    { name: 'Celo telo A', exercises: [
      { exercise: bench, rest_seconds: 120, notes: '', sets: [set, set, set] },
      { exercise: plank, rest_seconds: 60, notes: '', sets: [{ ...set, reps_min: null, reps_max: null, duration_seconds: 45, rpe: null }] },
    ] },
    { name: 'Celo telo B', exercises: [{ exercise: bench, rest_seconds: 120, notes: '', sets: [set] }] },
  ],
}

describe('suggested programs', () => {
  it('copies every routine with new IDs, the program name as a note and the prescriptions', () => {
    let n = 0
    const routines = programToRoutines(program, () => `id-${++n}`)
    expect(routines.map((r) => [r.id, r.name, r.notes])).toEqual([
      ['id-1', 'Celo telo A', 'Celo telo za početnike'],
      ['id-2', 'Celo telo B', 'Celo telo za početnike'],
    ])
    expect(routines[0].exercises[0]).toMatchObject({ exercise_id: 'e-bench', rest_seconds: 120 })
    expect(routines[0].exercises[0].sets).toHaveLength(3)
    expect(routines[0].exercises[0].sets[0]).toEqual(set)
    // A copy, not the same objects: editing the routine never changes the suggestion.
    expect(routines[0].exercises[0].sets[0]).not.toBe(set)
  })

  it('describes the prescription for the preview', () => {
    expect(describePrescription(program.routines[0].exercises[0], 's')).toBe('3 × 8–10 @ 6,5')
    expect(describePrescription(program.routines[0].exercises[1], 's')).toBe('1 × 45 s')
  })
})
