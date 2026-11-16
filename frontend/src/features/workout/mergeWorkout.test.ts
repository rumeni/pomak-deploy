import { describe, expect, it } from 'vitest'
import { ConcurrentWorkoutEditError, mergeWorkoutValue } from './mergeWorkout'

describe('three-way stable-key workout merge', () => {
  it('merges edits to different sets', () => {
    const base = [{ key: 'a', reps: '8' }, { key: 'b', reps: '8' }]
    const left = [{ key: 'a', reps: '10' }, base[1]]
    const right = [base[0], { key: 'b', reps: '12' }]
    expect(mergeWorkoutValue(base, left, right)).toEqual([
      { key: 'a', reps: '10' }, { key: 'b', reps: '12' },
    ])
  })
  it('preserves independently inserted sets and their UUIDs', () => {
    const base = [{ key: 'a', reps: '' }]
    const left = [...base, { key: 'new-left', reps: '10' }]
    const right = [...base, { key: 'new-right', reps: '12' }]
    expect(mergeWorkoutValue(base, left, right)).toEqual([...right, left[1]])
  })
  it('refuses stale edits of a removed or changed set', () => {
    const base = [{ key: 'a', reps: '8' }]
    const left = [{ key: 'a', reps: '9' }]
    expect(() => mergeWorkoutValue(base, left, [])).toThrow(ConcurrentWorkoutEditError)
    expect(() => mergeWorkoutValue(base, [], left)).toThrow(ConcurrentWorkoutEditError)
    expect(() => mergeWorkoutValue(base, left, [{ key: 'a', reps: '11' }])).toThrow(ConcurrentWorkoutEditError)
  })
})
