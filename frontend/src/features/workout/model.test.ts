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
  MAX_EXERCISE_NOTES,
  moveExercise,
  newActiveExercise,
  planSummary,
  removeExercise,
  replaceExercise,
  replacementLoss,
  rpeLoadRows,
  setExerciseNotes,
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

describe('changing exercises during a workout', () => {
  const squat: Exercise = { ...bench, id: 'squat', name: 'Squat', muscle: 'legs' }
  const plank: Exercise = { ...bench, id: 'plank', name: 'Plank', measurement: 'duration', muscle: 'core' }
  const rpePlan: Routine = {
    ...routine,
    exercises: [
      {
        exercise: bench, rest_seconds: 120, notes: '',
        sets: [
          { set_type: 'warmup', reps_min: 10, reps_max: 10, weight_kg: '40.00', duration_seconds: null, distance_m: null },
          { set_type: 'working', reps_min: 5, reps_max: 5, weight_kg: '80.00', duration_seconds: null, distance_m: null, rpe: '8.0' },
          { set_type: 'working', reps_min: 5, reps_max: 5, weight_kg: '80.00', duration_seconds: null, distance_m: null, rpe: '8.0' },
          { set_type: 'working', reps_min: 8, reps_max: 10, weight_kg: null, duration_seconds: null, distance_m: null, rpe: '7.0' },
        ],
      },
      { exercise: curl, rest_seconds: 60, notes: '', sets: [{ set_type: 'working', reps_min: 12, reps_max: 12, weight_kg: null, duration_seconds: null, distance_m: null }] },
      { exercise: pullup, rest_seconds: 60, notes: '', sets: [{ set_type: 'working', reps_min: null, reps_max: null, weight_kg: null, duration_seconds: null, distance_m: null }] },
    ],
  }

  it('moves exercises up and down and ignores moves past the ends', () => {
    const w = startFromRoutine(rpePlan, {}, t0)
    const [a, b, c] = w.exercises.map((e) => e.key)
    expect(moveExercise(w, b, -1).exercises.map((e) => e.key)).toEqual([b, a, c])
    expect(moveExercise(w, b, 1).exercises.map((e) => e.key)).toEqual([a, c, b])
    expect(moveExercise(w, a, -1)).toBe(w)
    expect(moveExercise(w, c, 1)).toBe(w)
    expect(moveExercise(w, 'missing', 1)).toBe(w)
  })

  it('removes an exercise and keeps notes within the API limit', () => {
    const w = startFromRoutine(rpePlan, {}, t0)
    expect(removeExercise(w, w.exercises[1].key).exercises.map((e) => e.exercise.id)).toEqual(['bench', 'pullup'])
    const noted = setExerciseNotes(w, w.exercises[0].key, 'x'.repeat(MAX_EXERCISE_NOTES + 50))
    expect(noted.exercises[0].notes).toHaveLength(MAX_EXERCISE_NOTES)
    const payload = toSessionPayload(confirmSet(
      updateSet(noted, noted.exercises[0].key, noted.exercises[0].sets[1].key, { reps: '5' }),
      noted.exercises[0].key, noted.exercises[0].sets[1].key, t0,
    ), t0, null, '')
    expect(payload.exercises[0].notes).toHaveLength(MAX_EXERCISE_NOTES)
  })

  it('swaps the exercise but keeps the planned reps and RPE, not the planned weight', () => {
    let w = startFromRoutine(rpePlan, {}, t0)
    const key = w.exercises[0].key
    w = setExerciseNotes(w, key, 'seat 4')
    const swapped = replaceExercise(w, key, squat)
    const item = swapped.exercises[0]
    expect(item.exercise.id).toBe('squat')
    expect(item.key).toBe(key)
    expect(item.notes).toBe('seat 4')
    expect(item.restSeconds).toBe(120)
    expect(item.sets.map((s) => s.set_type)).toEqual(['warmup', 'working', 'working', 'working'])
    expect(item.sets.map((s) => s.target?.weight_kg ?? null)).toEqual([null, null, null, null])
    expect(item.sets.map((s) => targetRpe(s))).toEqual([null, 8, 8, 7])
    expect(item.sets.every((s) => s.weight === '' && s.reps === '' && !s.done)).toBe(true)
  })

  it('starts from default sets when swapping between rep-based and timed work', () => {
    const w = startFromRoutine(rpePlan, {}, t0)
    const swapped = replaceExercise(w, w.exercises[0].key, plank).exercises[0]
    expect(swapped.sets).toHaveLength(1)
    expect(swapped.sets[0].target).toBeNull()
  })

  it('refuses to swap an exercise with confirmed sets', () => {
    let w = startFromRoutine(rpePlan, {}, t0)
    const ex = w.exercises[0]
    w = confirmSet(w, ex.key, ex.sets[0].key, t0)
    expect(() => replaceExercise(w, ex.key, squat)).toThrow('workout.errors.replaceDone')
    // Same exercise: nothing to do.
    expect(replaceExercise(w, ex.key, bench)).toBe(w)
  })

  it('summarises the plan, grouping consecutive equal working sets', () => {
    const w = startFromRoutine(rpePlan, {}, t0)
    expect(planSummary(w.exercises[0])).toEqual({
      warmups: 1,
      groups: [
        { count: 2, reps: '5', weight: '80', rpe: 8 },
        { count: 1, reps: '8–10', weight: null, rpe: 7 },
      ],
    })
    expect(planSummary(w.exercises[1])).toEqual({ warmups: 0, groups: [{ count: 1, reps: '12', weight: null, rpe: null }] })
    // A routine set with nothing prescribed is not a plan worth showing.
    expect(planSummary(w.exercises[2])).toBeNull()
    expect(planSummary(newActiveExercise(bench))).toBeNull()
  })
})

describe('review follow-ups: swap warnings and RPE load sources', () => {
  const squat: Exercise = { ...bench, id: 'squat', name: 'Squat', muscle: 'legs' }
  const plank: Exercise = { ...bench, id: 'plank', name: 'Plank', measurement: 'duration', muscle: 'core' }
  const mixed: Routine = {
    ...routine,
    exercises: [{
      exercise: bench, rest_seconds: 120, notes: '',
      sets: [
        { set_type: 'working', reps_min: 3, reps_max: 3, weight_kg: null, duration_seconds: null, distance_m: null, rpe: '8.0' },
        { set_type: 'working', reps_min: 5, reps_max: 5, weight_kg: '90.00', duration_seconds: null, distance_m: null, rpe: '8.0' },
        { set_type: 'working', reps_min: 12, reps_max: 12, weight_kg: null, duration_seconds: null, distance_m: null, rpe: '8.0' },
        { set_type: 'working', reps_min: 10, reps_max: 10, weight_kg: null, duration_seconds: null, distance_m: null },
      ],
    }],
  }
  const lastTime: Record<string, PreviousPerformance> = {
    bench: { session_id: 's0', started_at: '2026-09-20T10:00:00Z', sets: [
      { set_type: 'working', weight_kg: '100.00', reps: 5, duration_seconds: null, distance_m: null, rpe: '8.0' },
    ] },
  }

  it('reports typed but unconfirmed values and a set reset before a swap', () => {
    let w = startFromRoutine(mixed, lastTime, t0)
    const ex = w.exercises[0]
    expect(replacementLoss(ex, squat)).toEqual({ enteredSets: 0, resetsSets: false })
    w = updateSet(w, ex.key, ex.sets[0].key, { weight: '100' })
    w = updateSet(w, ex.key, ex.sets[1].key, { rpe: 7 })
    expect(replacementLoss(w.exercises[0], squat)).toEqual({ enteredSets: 2, resetsSets: false })
    expect(replacementLoss(w.exercises[0], plank)).toEqual({ enteredSets: 2, resetsSets: true })
    // Grey suggestions are not typed values.
    expect(replacementLoss(startFromRoutine(mixed, lastTime, t0).exercises[0], plank).enteredSets).toBe(0)
  })

  it('names, per row, which loads come from the RPE chart and which must be typed', () => {
    const w = startFromRoutine(mixed, lastTime, t0)
    const rows = rpeLoadRows(w, w.exercises[0])
    // Row 0: 3 @ 8 calculated; row 1: fixed 90 kg; row 2: 12 reps off the chart; row 3: no RPE.
    expect(rows.calculated).toEqual([0])
    expect(rows.missing).toEqual([2])
    expect(rows.e1rm).toBeCloseTo(123.46, 1)
    const noHistory = rpeLoadRows(startFromRoutine(mixed, {}, t0), w.exercises[0])
    expect(noHistory).toEqual({ calculated: [], missing: [0, 2], e1rm: null })
    // Rows with a typed or confirmed weight drop out of both lists.
    let filled = updateSet(w, w.exercises[0].key, w.exercises[0].sets[2].key, { weight: '70', reps: '12' })
    filled = confirmSet(filled, filled.exercises[0].key, filled.exercises[0].sets[2].key, t0)
    filled = updateSet(filled, filled.exercises[0].key, filled.exercises[0].sets[0].key, { weight: '102,5' })
    expect(rpeLoadRows(filled, filled.exercises[0])).toMatchObject({ calculated: [], missing: [] })
    // An RPE below the chart (3.5) also has no load.
    const low: Routine = { ...mixed, exercises: [{ ...mixed.exercises[0], sets: [{ ...mixed.exercises[0].sets[0], rpe: '3.5' }] }] }
    const lw = startFromRoutine(low, lastTime, t0)
    expect(rpeLoadRows(lw, lw.exercises[0])).toMatchObject({ calculated: [], missing: [0] })
  })
})

describe('timed prescriptions from a program', () => {
  const plankEx: Exercise = { ...bench, id: 'plank', name: 'Plank', measurement: 'duration', muscle: 'core' }
  const timed: Routine = {
    ...routine,
    exercises: [{
      exercise: plankEx, rest_seconds: 60, notes: '',
      sets: [1, 2].map(() => ({ set_type: 'working' as const, reps_min: null, reps_max: null, weight_kg: null, duration_seconds: 45, distance_m: null, rpe: null })),
    }],
  }

  it('carries the planned time into the workout, its plan line and the confirmed set', () => {
    let w = startFromRoutine(timed, {}, t0)
    const ex = w.exercises[0]
    expect(ex.sets[0].target).toMatchObject({ duration_seconds: 45 })
    expect(suggestion(w, ex, 0).duration).toBe('0:45')
    expect(planSummary(ex)).toEqual({ warmups: 0, groups: [{ count: 2, reps: null, weight: null, rpe: null, time: '0:45', km: null }] })
    w = confirmSet(w, ex.key, ex.sets[0].key, t0)
    expect(toSessionPayload(w, t0, null, '').exercises[0].sets[0]).toMatchObject({ duration_seconds: 45 })
  })

  it('still prefers last time over the plan', () => {
    const last: Record<string, PreviousPerformance> = {
      plank: { session_id: 's', started_at: '2026-09-20T10:00:00Z', sets: [{ set_type: 'working', weight_kg: null, reps: null, duration_seconds: 60, distance_m: null }] },
    }
    const w = startFromRoutine(timed, last, t0)
    expect(suggestion(w, w.exercises[0], 0).duration).toBe('1:00')
  })
})

