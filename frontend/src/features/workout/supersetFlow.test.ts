import { describe, expect, it } from 'vitest'

import type { Exercise, Routine, RoutineSet } from '../training/api'
import { confirmSet, moveExercise, newActiveExercise, nextInSuperset, removeExercise, restAfterSet, startFromRoutine, toSessionPayload, uploadSafePlanSnapshot } from './model'

const exercise = (id: string): Exercise => ({
  id, name: id, aliases: '', equipment: 'dumbbell', measurement: 'weight_reps', load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
})
const set: RoutineSet = { set_type: 'working', reps_min: 10, reps_max: 10, weight_kg: '20.00', duration_seconds: null, distance_m: null }

// Bench on its own, then a superset A: row (A1, its rest is never used) + fly (A2, 120 s after the round).
const routine: Routine = {
  id: 'r', name: 'Push/pull', notes: '', created_at: '', updated_at: '',
  exercises: [
    { exercise: exercise('bench'), rest_seconds: 90, notes: '', sets: [set, set] },
    { exercise: exercise('row'), rest_seconds: 60, notes: '', superset: 1, sets: [set, set] },
    { exercise: exercise('fly'), rest_seconds: 120, notes: '', superset: 1, sets: [set] },
  ],
}
const t0 = new Date('2026-11-23T10:00:00Z')

describe('a superset during the workout', () => {
  it('goes A1 -> A2 without a rest, and rests after the round with the last exercise rest', () => {
    let w = startFromRoutine(routine, {}, t0)
    const [, row, fly] = w.exercises
    expect(row.superset).toBe(1)

    w = confirmSet(w, row.key, row.sets[0].key, t0)
    expect(w.rest).toBeNull()
    expect(nextInSuperset(w, row.key, 0)?.key).toBe(fly.key)

    w = confirmSet(w, fly.key, fly.sets[0].key, t0)
    expect(w.rest?.totalSeconds).toBe(120)
    expect(nextInSuperset(w, fly.key, 0)).toBeNull()
  })

  it('a round where one exercise has fewer sets: the second row set alone ends the round', () => {
    let w = startFromRoutine(routine, {}, t0)
    const [, row, fly] = w.exercises
    w = confirmSet(w, row.key, row.sets[0].key, t0)
    w = confirmSet(w, fly.key, fly.sets[0].key, t0)
    w = { ...w, rest: null }
    w = confirmSet(w, row.key, row.sets[1].key, t0)
    expect(w.rest?.totalSeconds).toBe(120)
    expect(restAfterSet(w.exercises, row.key, 1)).toBe(120)
  })

  it('starting the round from A2 sends you to A1', () => {
    let w = startFromRoutine(routine, {}, t0)
    const [, row, fly] = w.exercises
    w = confirmSet(w, fly.key, fly.sets[0].key, t0)
    expect(w.rest).toBeNull()
    expect(nextInSuperset(w, fly.key, 0)?.key).toBe(row.key)
  })

  it('an exercise on its own keeps its own rest', () => {
    let w = startFromRoutine(routine, {}, t0)
    const bench = w.exercises[0]
    w = confirmSet(w, bench.key, bench.sets[0].key, t0)
    expect(w.rest?.totalSeconds).toBe(90)
    expect(nextInSuperset(w, bench.key, 0)).toBeNull()
  })

  it('removing one exercise of a pair leaves a single exercise with a normal rest', () => {
    let w = startFromRoutine(routine, {}, t0)
    w = removeExercise(w, w.exercises[2].key)
    const row = w.exercises[1]
    expect(row.superset).toBeNull()
    w = confirmSet(w, row.key, row.sets[0].key, t0)
    expect(w.rest?.totalSeconds).toBe(60)
  })

  it('moving the single exercise down jumps over the whole superset', () => {
    const started = startFromRoutine(routine, {}, t0)
    const moved = moveExercise(started, started.exercises[0].key, 1)
    expect(moved.exercises.map((e) => [e.exercise.id, e.superset ?? null])).toEqual([['row', 1], ['fly', 1], ['bench', null]])
  })

  it('an added exercise is on its own, and the finished workout keeps the superset', () => {
    let w = startFromRoutine(routine, {}, t0)
    w = { ...w, exercises: [...w.exercises, newActiveExercise(exercise('curl'))] }
    const [, row, fly] = w.exercises
    w = confirmSet(w, row.key, row.sets[0].key, t0)
    w = confirmSet(w, fly.key, fly.sets[0].key, t0)
    const payload = toSessionPayload(w, t0, null, '')
    expect(payload.exercises.map((e) => e.superset)).toEqual([null, 1, 1, null])
  })

  it('the plan snapshot keeps supersets when it has to be shortened', () => {
    const long: Routine = { ...routine, notes: 'x'.repeat(300 * 1024) }
    expect(uploadSafePlanSnapshot(long)!.exercises.map((e) => e.superset ?? null)).toEqual([null, 1, 1])
  })
})
