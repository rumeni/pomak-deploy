import { describe, expect, it } from 'vitest'
import { coachRoutineAvailability } from './routineEligibility'

describe('coachRoutineAvailability', () => {
  it('accepts populated workouts made exclusively from shared exercises', () => {
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: false } }] })).toBe('ready')
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: false } }, { exercise: { is_custom: false } }] })).toBe('ready')
  })
  it('accepts workouts with private coach exercises (they are copied to the client)', () => {
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: true } }] })).toBe('ready')
    expect(coachRoutineAvailability({ exercises: [{ exercise: { is_custom: false } }, { exercise: { is_custom: true } }] })).toBe('ready')
  })
  it('explains empty workouts rather than showing only the Rest option', () => {
    expect(coachRoutineAvailability({ exercises: [] })).toBe('empty')
  })
})
