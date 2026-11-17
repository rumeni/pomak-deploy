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

  it('keeps a local reorder when another tab edited a different row', () => {
    const base = [{ key: 'a', notes: '' }, { key: 'b', notes: '' }, { key: 'c', notes: '' }]
    const moved = [base[1], base[0], base[2]]
    const otherTab = [base[0], base[1], { key: 'c', notes: 'seat 4' }]
    expect(mergeWorkoutValue(base, moved, otherTab)).toEqual([base[1], base[0], { key: 'c', notes: 'seat 4' }])
  })
  it('keeps a reorder made in the other tab and merges local field edits into it', () => {
    const base = [{ key: 'a', notes: '' }, { key: 'b', notes: '' }]
    const local = [{ key: 'a', notes: 'x' }, base[1]]
    const otherTab = [base[1], base[0]]
    expect(mergeWorkoutValue(base, local, otherTab)).toEqual([base[1], { key: 'a', notes: 'x' }])
  })
  it('places rows added on either side around a reorder', () => {
    const base = [{ key: 'a' }, { key: 'b' }]
    const local = [{ key: 'b' }, { key: 'a' }, { key: 'new-left' }]
    const otherTab = [{ key: 'a' }, { key: 'b' }, { key: 'new-right' }]
    expect(mergeWorkoutValue(base, local, otherTab)).toEqual([{ key: 'b' }, { key: 'a' }, { key: 'new-right' }, { key: 'new-left' }])
  })
  it('treats the same reorder on both sides as agreement and different ones as a conflict', () => {
    const base = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
    const sameMove = [{ key: 'b' }, { key: 'a' }, { key: 'c' }]
    expect(mergeWorkoutValue(base, sameMove, [...sameMove])).toEqual(sameMove)
    const otherMove = [{ key: 'a' }, { key: 'c' }, { key: 'b' }]
    expect(() => mergeWorkoutValue(base, sameMove, otherMove)).toThrow(ConcurrentWorkoutEditError)
  })
})
