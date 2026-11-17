import { describe, expect, it } from 'vitest'

import type { Exercise } from '../training/api'
import type { WorkoutSession } from './api'
import { editChanged, editDraftToPayload, SessionEditError, sessionToEditDraft } from './edit'
import { emptyActiveSet } from './model'

const bench: Exercise = {
  id: 'bench', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
  load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
}
const plank: Exercise = { ...bench, id: 'plank', name: 'Plank', measurement: 'duration', muscle: 'core' }

const session: WorkoutSession = {
  id: 's1', routine_id: null, name: 'Snaga', started_at: '2026-11-17T10:00:00Z', finished_at: '2026-11-17T11:00:00Z',
  feeling: null, notes: '', updated_at: '2026-11-17T11:00:00.123456Z', edited_at: null,
  readiness: { sleep_hours: 6, hydration: null, stress: null, motivation: null, soreness_upper: null, soreness_lower: null },
  exercises: [
    { exercise: bench, notes: '', sets: [
      { set_type: 'warmup', weight_kg: '60.00', reps: 8, duration_seconds: null, distance_m: null, rpe: null, completed_at: '2026-11-17T10:05:00Z' },
      { set_type: 'working', weight_kg: '100.00', reps: 5, duration_seconds: null, distance_m: null, rpe: '8.0', completed_at: '2026-11-17T10:10:00Z' },
      { set_type: 'working', weight_kg: '100.00', reps: 5, duration_seconds: null, distance_m: null, rpe: null, completed_at: '2026-11-17T10:14:00Z' },
    ] },
    { exercise: plank, notes: 'na laktovima', sets: [
      { set_type: 'working', weight_kg: null, reps: null, duration_seconds: 75, distance_m: null, completed_at: '2026-11-17T10:40:00Z' },
    ] },
  ],
}

describe('correcting a finished workout', () => {
  it('turns the saved workout into an editable draft', () => {
    const draft = sessionToEditDraft(session)
    expect(draft.revision).toBe(session.updated_at)
    expect(draft.exercises[0].sets.map((s) => [s.weight, s.reps, s.rpe, s.done])).toEqual([
      ['60', '8', null, true], ['100', '5', 8, true], ['100', '5', null, true],
    ])
    expect(draft.exercises[1].sets[0].duration).toBe('1:15')
    expect(draft.exercises[1].notes).toBe('na laktovima')
  })

  it('has nothing to save until something changes', () => {
    const initial = sessionToEditDraft(session)
    expect(editChanged(initial, initial)).toBe(false)
    // Re-typing the same number in another form is not a change.
    const same = { ...initial, exercises: [{ ...initial.exercises[0], sets: initial.exercises[0].sets.map((s, i) => (i === 1 ? { ...s, weight: '100,0' } : s)) }, initial.exercises[1]] }
    expect(editChanged(initial, same)).toBe(false)
    expect(editChanged(initial, { ...initial, notes: 'x' })).toBe(true)
  })

  it('sends corrected values with each set keeping its original time', () => {
    const draft = sessionToEditDraft(session)
    const bench = draft.exercises[0]
    draft.exercises[0] = {
      ...bench,
      notes: 'uži hvat',
      // Remove the first working set, fix the second, add one more.
      sets: [bench.sets[0], { ...bench.sets[2], weight: '102,5', rpe: 9 }, { ...emptyActiveSet(), done: true, weight: '90', reps: '8' }],
    }
    draft.feeling = 4
    draft.readiness = { ...draft.readiness, sleep_hours: null, stress: 2 }
    const body = editDraftToPayload(draft)
    expect(body.revision).toBe(session.updated_at)
    expect(body.exercises[0]).toMatchObject({ exercise_id: 'bench', notes: 'uži hvat' })
    expect(body.exercises[0].sets.map((s) => [s.weight_kg, s.reps, s.rpe ?? null, s.completed_at])).toEqual([
      ['60', 8, null, '2026-11-17T10:05:00Z'],
      ['102.5', 5, '9', '2026-11-17T10:14:00Z'],
      ['90', 8, null, null],
    ])
    // A cleared answer is sent as null, so it is cleared on the server too.
    expect(body.readiness).toEqual({ sleep_hours: null, hydration: null, stress: 2, motivation: null, soreness_upper: null, soreness_lower: null })
    expect(body.exercises[1].sets[0]).toMatchObject({ duration_seconds: 75, completed_at: '2026-11-17T10:40:00Z' })
  })

  it('names the exercise when a value is wrong or an exercise has no sets', () => {
    const draft = sessionToEditDraft(session)
    draft.exercises[0].sets[1] = { ...draft.exercises[0].sets[1], reps: '' }
    expect(() => editDraftToPayload(draft)).toThrow(SessionEditError)
    try {
      editDraftToPayload(draft)
    } catch (e) {
      expect((e as SessionEditError).exercise).toBe('Bench')
      expect((e as SessionEditError).key).toBe('workout.errors.needReps')
    }
    const empty = sessionToEditDraft(session)
    empty.exercises[1] = { ...empty.exercises[1], sets: [] }
    expect(() => editDraftToPayload(empty)).toThrow('history.edit.errors.noSets')
    expect(() => editDraftToPayload({ ...sessionToEditDraft(session), name: '  ' })).toThrow('history.edit.errors.name')
  })
})
