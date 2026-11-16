import { describe, expect, it } from 'vitest'

import type { Exercise, Routine } from '../training/api'
import {
  confirmSet,
  finishTimeForWorkout,
  describeLogged,
  previousSet,
  SetInputError,
  startFromRoutine,
  suggestion,
  summarize,
  toSessionPayload,
  unconfirmSet,
  updateSet,
  type PreviousPerformance,
} from './model'

const bench: Exercise = {
  id: 'bench', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
  load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
}
const curl: Exercise = { ...bench, id: 'curl', name: 'Curl', equipment: 'dumbbell', load_mode: 'per_side' }
const pullup: Exercise = { ...bench, id: 'pullup', name: 'Zgib', measurement: 'bodyweight_reps' }

const routine: Routine = {
  id: 'r1', name: 'Trening A', notes: '', created_at: '', updated_at: '',
  exercises: [
    {
      exercise: bench, rest_seconds: 90, notes: '',
      sets: [
        { set_type: 'warmup', reps_min: 10, reps_max: 10, weight_kg: '40.00', duration_seconds: null, distance_m: null },
        { set_type: 'working', reps_min: 8, reps_max: 10, weight_kg: '60.00', duration_seconds: null, distance_m: null },
      ],
    },
    { exercise: curl, rest_seconds: 60, notes: '', sets: [{ set_type: 'working', reps_min: 12, reps_max: 12, weight_kg: '12.50', duration_seconds: null, distance_m: null }] },
    { exercise: pullup, rest_seconds: 0, notes: '', sets: [{ set_type: 'working', reps_min: null, reps_max: null, weight_kg: null, duration_seconds: null, distance_m: null }] },
  ],
}

const previous: Record<string, PreviousPerformance> = {
  bench: {
    session_id: 's0', started_at: '2026-09-20T10:00:00Z',
    sets: [
      { set_type: 'warmup', weight_kg: '40.00', reps: 10, duration_seconds: null, distance_m: null },
      { set_type: 'working', weight_kg: '62.50', reps: 9, duration_seconds: null, distance_m: null },
    ],
  },
}

const t0 = new Date('2026-09-25T10:00:00Z')
const start = () => startFromRoutine(routine, previous, t0)

describe('start i ponuđene vrednosti', () => {
  it('prošli rezultat ima prednost nad planom, a plan se koristi kad nema istorije', () => {
    const w = start()
    expect(suggestion(w, w.exercises[0], 1)).toMatchObject({ weight: '62,5', reps: '9' })
    expect(suggestion(w, w.exercises[1], 0)).toMatchObject({ weight: '12,5', reps: '12' })
    expect(suggestion(w, w.exercises[2], 0)).toMatchObject({ weight: '', reps: '' })
  })

  it('uparuje prošle serije po vrsti: radna sa radnom, zagrevanje sa zagrevanjem', () => {
    const onlyWorking: Record<string, PreviousPerformance> = {
      bench: { session_id: 's', started_at: '2026-09-30T10:00:00Z', sets: [previous.bench.sets[1]] },
    }
    const w = startFromRoutine(routine, onlyWorking, t0)
    const ex = w.exercises[0]
    expect(previousSet(w, ex, 0)).toBeNull() // zagrevanje: prošli put ga nije bilo
    expect(previousSet(w, ex, 1)?.weight_kg).toBe('62.50')
  })

  it('opisuje prošli rezultat za kolonu PROŠLI PUT', () => {
    expect(describeLogged(previous.bench.sets[1], bench, 'pon.')).toBe('62,5 × 9')
    expect(describeLogged(null, bench, 'pon.')).toBe('–')
    expect(describeLogged({ set_type: 'working', weight_kg: null, reps: 8, duration_seconds: null, distance_m: null }, pullup, 'pon.')).toBe('8 pon.')
  })
})

describe('potvrda serije', () => {
  it('prazna polja dobijaju ponuđenu vrednost tek pri potvrdi i počinje pauza', () => {
    const w = start()
    const ex = w.exercises[0]
    expect(ex.sets[1].done).toBe(false)

    const after = confirmSet(w, ex.key, ex.sets[1].key, t0)
    expect(after.exercises[0].sets[1]).toMatchObject({ weight: '62,5', reps: '9', done: true, completedAt: t0.toISOString() })
    expect(after.rest).toEqual({ endsAt: '2026-09-25T10:01:30.000Z', totalSeconds: 90 })
  })

  it('upisana vrednost ima prednost nad ponuđenom', () => {
    let w = start()
    const ex = w.exercises[0]
    w = updateSet(w, ex.key, ex.sets[1].key, { reps: '10' })
    w = confirmSet(w, ex.key, ex.sets[1].key, t0)
    expect(w.exercises[0].sets[1]).toMatchObject({ weight: '62,5', reps: '10' })
  })

  it('bez ponuđene vrednosti traži unos i ne potvrđuje seriju', () => {
    const w = start()
    const ex = w.exercises[2]
    expect(() => confirmSet(w, ex.key, ex.sets[0].key, t0)).toThrow(SetInputError)
    expect(() => confirmSet(w, ex.key, ex.sets[0].key, t0)).toThrow('workout.errors.needReps')
  })

  it('vežba bez pauze ne pokreće tajmer', () => {
    let w = start()
    const ex = w.exercises[2]
    w = updateSet(w, ex.key, ex.sets[0].key, { reps: '8' })
    expect(confirmSet(w, ex.key, ex.sets[0].key, t0).rest).toBeNull()
  })

  it('poništena potvrda vraća seriju u nepotvrđenu, a vrednosti ostaju', () => {
    let w = start()
    const ex = w.exercises[0]
    w = confirmSet(w, ex.key, ex.sets[1].key, t0)
    w = unconfirmSet(w, ex.key, ex.sets[1].key)
    expect(w.exercises[0].sets[1]).toMatchObject({ done: false, completedAt: null, weight: '62,5' })
  })
})

describe('kraj treninga', () => {
  it('šalje samo potvrđene serije, u obliku za server', () => {
    let w = start()
    const [b, c] = w.exercises
    w = confirmSet(w, b.key, b.sets[1].key, t0)
    w = confirmSet(w, c.key, c.sets[0].key, t0)

    const payload = toSessionPayload(w, new Date('2026-09-25T11:00:00Z'), 4, 'ok')
    expect(payload).toMatchObject({ id: w.id, routine_id: 'r1', name: 'Trening A', feeling: 4, plan_snapshot: routine })
    expect(payload.exercises[0].sets).toEqual([
      { set_type: 'working', weight_kg: '62.5', reps: 9, duration_seconds: null, distance_m: null, completed_at: t0.toISOString() },
    ])
    expect(payload.exercises[2].sets).toEqual([])
  })

  it('sažetak: trajanje, serije i obim (bučice se računaju dve)', () => {
    let w = start()
    const [b, c] = w.exercises
    w = confirmSet(w, b.key, b.sets[0].key, t0) // zagrevanje ne ulazi u obim
    w = confirmSet(w, b.key, b.sets[1].key, t0)
    w = confirmSet(w, c.key, c.sets[0].key, t0)
    expect(summarize(w, new Date('2026-09-25T10:45:00Z'))).toEqual({
      durationSeconds: 45 * 60,
      doneSets: 3,
      exercisesWithSets: 2,
      volumeKg: Math.round(62.5 * 9 + 12.5 * 12 * 2),
    })
  })
})

describe('safe workout times after leaving the app open', () => {
  it('ends a stale session at the last confirmed set rather than opening Finish the next day', () => {
    let w = start()
    const item = w.exercises[0]
    w = confirmSet(w, item.key, item.sets[1].key, new Date('2026-09-25T10:45:00Z'))
    const finishedAt = finishTimeForWorkout(w, new Date('2026-09-27T12:00:00Z'))
    expect(finishedAt.toISOString()).toBe('2026-09-25T10:45:00.000Z')
    const payload = toSessionPayload(w, finishedAt, null, '')
    expect(payload.finished_at).toBe('2026-09-25T10:45:00.000Z')
  })

  it('keeps the actual finish time for an ordinary workout', () => {
    const end = new Date('2026-09-25T10:45:00Z')
    expect(finishTimeForWorkout(start(), end)).toEqual(end)
  })

  it('never sends duration beyond 24h even if a confirmed set was recorded later', () => {
    let w = start()
    const ex = w.exercises[0]
    w = confirmSet(w, ex.key, ex.sets[1].key, new Date('2026-09-27T10:00:00Z'))
    expect(finishTimeForWorkout(w, new Date('2026-09-27T12:00:00Z')).toISOString()).toBe('2026-09-26T10:00:00.000Z')
  })
})

describe('validate workout sets against backend limits before confirming', () => {
  it('rejects repetitions over 1000', () => {
    let w = start()
    const ex = w.exercises[0]
    w = updateSet(w, ex.key, ex.sets[1].key, { reps: '1001' })
    expect(() => confirmSet(w, ex.key, ex.sets[1].key, t0)).toThrow('workout.errors.invalidReps')
  })

  it('rejects out-of-range weights and more than two decimal places', () => {
    for (const weight of ['1000.01', '1000,001', '20.123']) {
      let w = start()
      const ex = w.exercises[0]
      w = updateSet(w, ex.key, ex.sets[1].key, { weight })
      expect(() => confirmSet(w, ex.key, ex.sets[1].key, t0)).toThrow('workout.errors.invalidWeight')
    }
  })

  it('rejects distances beyond 500 km and durations beyond 24h', () => {
    const duration = { ...bench, measurement: 'duration' as const }
    const distance = { ...bench, measurement: 'distance_duration' as const }
    const base = start()
    const e = base.exercises[0]
    const day = { ...e, exercise: duration, sets: [{ ...e.sets[0], duration: '24:00:01' }] }
    expect(() => confirmSet({ ...base, exercises: [day] }, e.key, day.sets[0].key, t0)).toThrow('workout.errors.invalidDuration')
    const long = { ...e, exercise: distance, sets: [{ ...e.sets[0], distance: '500.001', duration: '10:00' }] }
    expect(() => confirmSet({ ...base, exercises: [long] }, e.key, long.sets[0].key, t0)).toThrow('workout.errors.invalidWeight')
  })
})

describe('older locally persisted confirmed sets', () => {
  it('accepts exact decimal values with legacy trailing zeros', () => {
    let w = start()
    const item = w.exercises[0]
    w = confirmSet(w, item.key, item.sets[1].key, t0)
    w = updateSet(w, item.key, item.sets[1].key, { weight: '60.000', done: true })
    expect(summarize(w, new Date('2026-09-25T11:00:00Z')).doneSets).toBe(1)
    expect(toSessionPayload(w, new Date('2026-09-25T11:00:00Z'), null, '').exercises[0].sets[0].weight_kg).toBe('60')
  })

  it('does not crash summary for invalid legacy sets and keeps data editable', () => {
    let w = start()
    const item = w.exercises[0]
    w = confirmSet(w, item.key, item.sets[1].key, t0)
    w = updateSet(w, item.key, item.sets[1].key, { weight: '1500', done: true })
    expect(summarize(w, new Date('2026-09-25T11:00:00Z')).doneSets).toBe(1)
    expect(() => toSessionPayload(w, new Date('2026-09-25T11:00:00Z'), null, '')).toThrow('workout.errors.invalidWeight')
  })
})

describe('preserving original completion time when restoring a rejected workout', () => {
  it('keeps the original finish time if the user only edits an existing set', () => {
    const w = { ...start(), recoveredFinishedAt: '2026-09-25T11:00:00.000Z' }
    expect(finishTimeForWorkout(w, new Date('2026-09-25T14:00:00Z')).toISOString())
      .toBe('2026-09-25T11:00:00.000Z')
  })

  it('extends the restored finish only when a newly confirmed set is later', () => {
    const restored = { ...start(), recoveredFinishedAt: '2026-09-25T11:00:00.000Z' }
    const item = restored.exercises[0]
    const w = confirmSet(restored, item.key, item.sets[1].key, new Date('2026-09-25T13:00:00Z'))
    expect(finishTimeForWorkout(w, new Date('2026-09-25T14:00:00Z')).toISOString())
      .toBe('2026-09-25T13:00:00.000Z')
  })
})
