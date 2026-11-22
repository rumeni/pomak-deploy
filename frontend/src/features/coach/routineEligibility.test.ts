import { describe, expect, it } from 'vitest'
import { coachRoutineAvailability } from './routineEligibility'

describe('coachRoutineAvailability', () => {
  it('accepts populated workouts made exclusively from shared exercises', () => {
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: false } }] })).toBe('ready')
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: false } }, { exercise: { is_custom: false } }] })).toBe('ready')
  })
  it('explains hidden workouts rather than showing only the Rest option', () => {
    expect(coachRoutineAvailability({ exercises: [] })).toBe('empty')
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: true } }] })).toBe('private')
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: false } }, { exercise: { is_custom: true } }] })).toBe('private')
  })
})
