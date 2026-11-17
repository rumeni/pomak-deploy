import { describe, expect, it } from 'vitest'

import type { Exercise, Routine } from '../training/api'
import {
  confirmSet,
  finishTimeForWorkout,
  describeLogged,
  previousSet,
  prepareSessionPayload,
  rpeTargetWeight,
  targetRpe,
  MAX_WORKOUT_SNAPSHOT_BYTES,
  SetInputError,
  startFromRoutine,
  suggestion,
  summarize,
  toSessionPayload,
  uploadSafePlanSnapshot,
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

describe('oversized plan snapshot regression (Codex PR #38)', () => {
  it('preserves normal snapshots and only strips oversized presentation text', () => {
    const normal = toSessionPayload(start(), new Date('2026-09-25T11:00:00Z'), null, '')
    expect(normal.plan_snapshot).toEqual(routine)

    const huge = {
      ...routine,
      notes: 'routine notes' + 'n'.repeat(300_000),
      exercises: routine.exercises.map((e) => ({
        ...e,
        exercise: { ...e.exercise, instructions: 'long explanation'.repeat(30_000) },
      })),
    }
    const before = startFromRoutine(huge, previous, t0)
    expect(before.planSnapshot).toEqual(huge)
    const ready = toSessionPayload(before, new Date('2026-09-25T11:00:00Z'), null, '')
    expect(new TextEncoder().encode(JSON.stringify(ready.plan_snapshot)).byteLength).toBeLessThanOrEqual(MAX_WORKOUT_SNAPSHOT_BYTES)
    expect(ready.plan_snapshot?.exercises.map((e) => e.exercise.id)).toEqual(routine.exercises.map((e) => e.exercise.id))
    expect(ready.plan_snapshot?.exercises.map((e) => e.sets)).toEqual(routine.exercises.map((e) => e.sets))
    expect(ready.plan_snapshot?.exercises[0].exercise.instructions).toBe('')
    expect(before.planSnapshot).toEqual(huge) // no local destructive edit
    expect(uploadSafePlanSnapshot(routine)).toBe(routine)
    expect(prepareSessionPayload(normal)).toBe(normal)
  })

  it('keeps whole emoji at every truncation boundary (no lone surrogates)', () => {
    const emoji = '😃'
    const giant = {
      ...routine,
      name: 'r'.repeat(99) + emoji,
      notes: 'n'.repeat(8191) + emoji + 'x'.repeat(300_000),
      exercises: [{
        ...routine.exercises[0],
        notes: 'a'.repeat(299) + emoji,
        exercise: {
          ...bench,
          name: 'e'.repeat(119) + emoji,
          instructions: 'long'.repeat(80_000),
        },
      }],
    }
    const compact = uploadSafePlanSnapshot(giant)
    expect(compact?.name).toBe('r'.repeat(99) + emoji)
    expect(compact?.notes).toBe('n'.repeat(8191) + emoji)
    expect(compact?.exercises[0].notes).toBe('a'.repeat(299) + emoji)
    expect(compact?.exercises[0].exercise.name).toBe('e'.repeat(119) + emoji)
    expect(new TextEncoder().encode(JSON.stringify(compact)).byteLength).toBeLessThanOrEqual(MAX_WORKOUT_SNAPSHOT_BYTES)
  })

  it('repairs previously queued large snapshots without modifying logged sets', () => {
    const old = toSessionPayload(start(), new Date('2026-09-25T11:00:00Z'), null, '')
    const huge = { ...routine, notes: 'n'.repeat(400_000) }
    const legacy = { ...old, plan_snapshot: huge }
    const fixed = prepareSessionPayload(legacy)
    expect(new TextEncoder().encode(JSON.stringify(fixed.plan_snapshot)).byteLength).toBeLessThanOrEqual(MAX_WORKOUT_SNAPSHOT_BYTES)
    expect(fixed.id).toBe(old.id)
    expect(fixed.exercises).toBe(old.exercises)
    expect(legacy.plan_snapshot).toBe(huge)
  })
})

describe('RPE and readiness', () => {
  const rpeRoutine: Routine = {
    ...routine,
    exercises: [{
      exercise: bench, rest_seconds: 180, notes: '',
      sets: [
        { set_type: 'working', reps_min: 3, reps_max: 3, weight_kg: null, duration_seconds: null, distance_m: null, rpe: '8.0' },
        // A fixed weight in the plan is the coach's call; RPE does not override it.
        { set_type: 'working', reps_min: 3, reps_max: 3, weight_kg: '90.00', duration_seconds: null, distance_m: null, rpe: '8.0' },
      ],
    }],
  }
  const lastTime: Record<string, PreviousPerformance> = {
    bench: {
      session_id: 's0', started_at: '2026-09-20T10:00:00Z',
      sets: [
        { set_type: 'working', weight_kg: '100.00', reps: 5, duration_seconds: null, distance_m: null, rpe: '8.0' },
        { set_type: 'working', weight_kg: '95.00', reps: 5, duration_seconds: null, distance_m: null, rpe: null },
      ],
    },
  }

  it('suggests the weight for a set prescribed by RPE from last time\'s estimated 1RM', () => {
    const w = startFromRoutine(rpeRoutine, lastTime, t0)
    expect(w.exercises[0].sets[0].target?.rpe).toBe(8)
    // 100 x 5 @ 8 -> e1RM 123.5; 3 @ 8 = 86% -> 106.2 -> 105 kg; reps follow the plan
    expect(suggestion(w, w.exercises[0], 0)).toMatchObject({ weight: '105', reps: '3' })
    expect(suggestion(w, w.exercises[0], 1)).toMatchObject({ weight: '95' })
  })

  it('recalculates the RPE load for the reps the athlete actually types', () => {
    let w = startFromRoutine(rpeRoutine, lastTime, t0)
    const ex = w.exercises[0]
    // 8 @ 8 = 74% of 123.5 -> 91.4 -> 92.5 kg, not the 105 kg planned for 3 reps
    w = updateSet(w, ex.key, ex.sets[0].key, { reps: '8' })
    expect(suggestion(w, w.exercises[0], 0)).toMatchObject({ weight: '92,5', reps: '8' })
    w = confirmSet(w, ex.key, ex.sets[0].key, t0)
    expect(toSessionPayload(w, t0, null, '').exercises[0].sets[0]).toMatchObject({ weight_kg: '92.5', reps: 8 })
  })

  it('asks for the weight when the chart has no value for the typed reps', () => {
    let w = startFromRoutine(rpeRoutine, lastTime, t0)
    const ex = w.exercises[0]
    w = updateSet(w, ex.key, ex.sets[0].key, { reps: '12' })
    // Never falls back to last time's 100 kg for a 12-rep set at RPE 8.
    expect(suggestion(w, w.exercises[0], 0).weight).toBe('')
    expect(() => confirmSet(w, ex.key, ex.sets[0].key, t0)).toThrow(SetInputError)
  })

  it('drops the RPE target and its load when a working set becomes a warm-up', () => {
    let w = startFromRoutine(rpeRoutine, lastTime, t0)
    const ex = w.exercises[0]
    expect(targetRpe(w.exercises[0].sets[0])).toBe(8)
    w = updateSet(w, ex.key, ex.sets[0].key, { set_type: 'warmup' })
    expect(targetRpe(w.exercises[0].sets[0])).toBeNull()
    expect(rpeTargetWeight(w, w.exercises[0], 0)).toBeNull()
    // No 105 kg "@8" load on a warm-up; there is no earlier warm-up either, so the field stays empty.
    expect(suggestion(w, w.exercises[0], 0).weight).toBe('')
    // Switching back restores the plan.
    w = updateSet(w, ex.key, ex.sets[0].key, { set_type: 'working' })
    expect(suggestion(w, w.exercises[0], 0)).toMatchObject({ weight: '105', reps: '3' })
  })

  it('never falls back to the previous load when the RPE load cannot be estimated', () => {
    // Only 12-rep sets last time: outside the 1-10 rep estimate range.
    const highReps: Record<string, PreviousPerformance> = {
      bench: { session_id: 's0', started_at: '2026-09-20T10:00:00Z', sets: [
        { set_type: 'working', weight_kg: '100.00', reps: 12, duration_seconds: null, distance_m: null, rpe: '8.0' },
      ] },
    }
    for (const history of [highReps, {}]) {
      const w = startFromRoutine(rpeRoutine, history, t0)
      const ex = w.exercises[0]
      expect(rpeTargetWeight(w, ex, 0)).toEqual({ weight: null, reps: 3 })
      // The prescription (3 reps) is offered, the old 100 x 12 is not.
      expect(suggestion(w, ex, 0)).toMatchObject({ weight: '', reps: '3' })
      expect(() => confirmSet(w, ex.key, ex.sets[0].key, t0)).toThrow(SetInputError)
      // Typing the weight is enough.
      const typed = updateSet(w, ex.key, ex.sets[0].key, { weight: '90' })
      const done = confirmSet(typed, ex.key, ex.sets[0].key, t0)
      expect(toSessionPayload(done, t0, null, '').exercises[0].sets[0]).toMatchObject({ weight_kg: '90', reps: 3 })
    }
  })

  it('keeps an API-set RPE outside the picker range', () => {
    const low: Routine = { ...rpeRoutine, exercises: [{ ...rpeRoutine.exercises[0], sets: [{ ...rpeRoutine.exercises[0].sets[0], rpe: '3.5' }] }] }
    const w = startFromRoutine(low, {}, t0)
    expect(w.exercises[0].sets[0].target?.rpe).toBe(3.5)
  })

  it('sends RPE with the set and the check-in only when answered', () => {
    let w = startFromRoutine(rpeRoutine, lastTime, t0)
    const ex = w.exercises[0]
    w = updateSet(w, ex.key, ex.sets[0].key, { weight: '105', reps: '3', rpe: 8.5 })
    w = confirmSet(w, ex.key, ex.sets[0].key, t0)
    w = confirmSet(w, ex.key, ex.sets[1].key, t0)
    let payload = toSessionPayload(w, t0, null, '')
    expect(payload.exercises[0].sets.map((s) => s.rpe ?? null)).toEqual(['8.5', null])
    expect(payload).not.toHaveProperty('readiness')

    w = { ...w, readiness: { sleep_hours: 7, hydration: null, stress: 2, motivation: 4, soreness_upper: null, soreness_lower: null } }
    payload = toSessionPayload(w, t0, null, '')
    expect(payload.readiness).toMatchObject({ sleep_hours: 7, stress: 2 })
  })

  it('shows RPE in history but not in the "last time" column', () => {
    const set = { set_type: 'working' as const, weight_kg: '100.00', reps: 5, duration_seconds: null, distance_m: null, rpe: '7.5' }
    expect(describeLogged(set, bench, 'pon.')).toBe('100 × 5')
    expect(describeLogged(set, bench, 'pon.', true)).toBe('100 × 5 @ 7,5')
  })
})
