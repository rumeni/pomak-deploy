import { describe, expect, it } from 'vitest'

import type { Exercise, Routine } from './api'
import { DraftError, MAX_ROUTINE_EXERCISES, MAX_ROUTINE_SETS, draftToPayload, newDraftExercise, newRoutineDraft, parseDuration, parseRepRange, routineToDraft } from './draft'

const bench: Exercise = {
  id: 'e1', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
  load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
}
const run: Exercise = { ...bench, id: 'e2', name: 'Trčanje', measurement: 'distance_duration', muscle: 'cardio' }

describe('parseRepRange', () => {
  it('čita jedan broj i raspon', () => {
    expect(parseRepRange('10')).toEqual([10, 10])
    expect(parseRepRange('8-10')).toEqual([8, 10])
    expect(parseRepRange(' 8 – 12 ')).toEqual([8, 12])
    expect(parseRepRange('')).toEqual([null, null])
  })
  it('odbija neispravno', () => {
    expect(() => parseRepRange('10-8')).toThrow(DraftError)
    expect(() => parseRepRange('abc')).toThrow(DraftError)
    expect(() => parseRepRange('0')).toThrow(DraftError)
  })
})

describe('parseDuration', () => {
  it('čita sekunde, m:ss i h:mm:ss', () => {
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('1:02:05')).toBe(3725)
    expect(parseDuration('')).toBeNull()
  })
  it('odbija neispravno', () => {
    expect(() => parseDuration('1,5')).toThrow(DraftError)
    expect(() => parseDuration('0:00')).toThrow(DraftError)
  })
})

describe('draftToPayload', () => {
  it('accepts 40 exercises and 20 sets, rejects 41 exercises and 21 sets before upload', () => {
    const draft = newRoutineDraft()
    draft.name = 'Long workout'
    const single = newDraftExercise(bench)
    single.sets = [single.sets[0]]
    draft.exercises = Array.from({ length: MAX_ROUTINE_EXERCISES }, () => ({ ...single, key: crypto.randomUUID() }))
    expect(draftToPayload(draft).exercises).toHaveLength(40)
    draft.exercises.push(newDraftExercise(bench))
    expect(() => draftToPayload(draft)).toThrow('tooManyExercises')

    const another = newRoutineDraft()
    another.name = 'Twenty sets'
    another.exercises = [newDraftExercise(bench)]
    const item = another.exercises[0]
    item.sets = Array.from({ length: MAX_ROUTINE_SETS }, () => ({ ...item.sets[0] }))
    expect(draftToPayload(another).exercises[0].sets).toHaveLength(20)
    item.sets.push({ ...item.sets[0] })
    expect(() => draftToPayload(another)).toThrow('tooManySets')
  })

  it('pretvara zarez u tačku, km u metre i šalje samo polja koja vežba koristi', () => {
    const draft = newRoutineDraft()
    draft.name = ' Trening A '
    const b = newDraftExercise(bench)
    b.sets = [{ ...b.sets[0], reps: '8-10', weight: '62,5', duration: '5:00' }]
    const r = newDraftExercise(run)
    r.sets = [{ ...r.sets[0], reps: '10', distance: '2,5', duration: '15:00' }]
    draft.exercises = [b, r]

    const payload = draftToPayload(draft)
    expect(payload.name).toBe('Trening A')
    expect(payload.exercises[0].sets[0]).toMatchObject({ reps_min: 8, reps_max: 10, weight_kg: '62.5', duration_seconds: null })
    expect(payload.exercises[1].sets[0]).toMatchObject({ reps_min: null, distance_m: 2500, duration_seconds: 900, weight_kg: null })
  })

  it('keeps target RPE only on working sets counted in reps', () => {
    const draft = newRoutineDraft()
    draft.name = 'Snaga'
    const b = newDraftExercise(bench)
    b.sets = [
      { ...b.sets[0], set_type: 'warmup', reps: '5', weight: '60', rpe: '6' },
      { ...b.sets[1], reps: '5', rpe: '8' },
      { ...b.sets[2], reps: '5', rpe: '7.5' },
    ]
    const r = newDraftExercise(run)
    r.sets = [{ ...r.sets[0], duration: '15:00', rpe: '7' }]
    draft.exercises = [b, r]
    const payload = draftToPayload(draft)
    expect(payload.exercises[0].sets.map((s) => s.rpe)).toEqual([null, '8', '7.5'])
    expect(payload.exercises[1].sets[0].rpe).toBeNull()
    const back = routineToDraft({ id: 'r', name: 'Snaga', notes: '', created_at: '', updated_at: '', exercises: [{
      exercise: bench, rest_seconds: 120, notes: '', sets: [{ ...payload.exercises[0].sets[1], rpe: '8.0' }],
    }] })
    expect(back.exercises[0].sets[0].rpe).toBe('8')
  })

  it('round-trips a target RPE below the picker range (3.5) without dropping it', () => {
    const routine: Routine = { id: 'r', name: 'Lako', notes: '', created_at: '', updated_at: '', exercises: [{
      exercise: bench, rest_seconds: 90, notes: '',
      sets: [{ set_type: 'working', reps_min: 5, reps_max: 5, weight_kg: null, duration_seconds: null, distance_m: null, rpe: '3.5' }],
    }] }
    const draft = routineToDraft(routine)
    expect(draft.exercises[0].sets[0].rpe).toBe('3.5')
    expect(draftToPayload(draft).exercises[0].sets[0].rpe).toBe('3.5')
  })

  it('traži naziv i bar jednu vežbu', () => {
    const draft = newRoutineDraft()
    expect(() => draftToPayload(draft)).toThrow('nameRequired')
    draft.name = 'A'
    expect(() => draftToPayload(draft)).toThrow('noExercises')
  })

  it('vraća isti sadržaj posle kruga server -> nacrt -> server', () => {
    const routine: Routine = {
      id: 'r1', name: 'A', notes: '', created_at: '', updated_at: '',
      exercises: [{
        exercise: bench, rest_seconds: 120, notes: '',
        sets: [{ set_type: 'warmup', reps_min: 8, reps_max: 10, weight_kg: '62.50', duration_seconds: null, distance_m: null }],
      }],
    }
    const draft = routineToDraft(routine)
    expect(draft.exercises[0].sets[0]).toMatchObject({ reps: '8-10', weight: '62,5' })
    expect(draftToPayload(draft).exercises[0].sets[0]).toMatchObject({ set_type: 'warmup', reps_min: 8, reps_max: 10, weight_kg: '62.5' })
  })
})

describe('supersets in the editor', () => {
  it('a saved superset comes back the same, and a new exercise is on its own', () => {
    const set = { set_type: 'working' as const, reps_min: 10, reps_max: 10, weight_kg: null, duration_seconds: null, distance_m: null }
    const routine: Routine = {
      id: 'r', name: 'A', notes: '', created_at: '', updated_at: 'u',
      exercises: [
        { exercise: bench, rest_seconds: 0, notes: '', superset: 1, sets: [set] },
        { exercise: { ...bench, id: 'e3' }, rest_seconds: 90, notes: '', superset: 1, sets: [set] },
        // Saved before supersets existed: no field at all.
        { exercise: { ...bench, id: 'e4' }, rest_seconds: 90, notes: '', sets: [set] },
      ],
    }
    const draft = routineToDraft(routine)
    draft.exercises.push(newDraftExercise(bench))
    expect(draftToPayload(draft).exercises.map((e) => e.superset)).toEqual([1, 1, null, null])
  })
})
