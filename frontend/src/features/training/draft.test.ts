import { describe, expect, it } from 'vitest'

import type { Exercise, Routine } from './api'
import { DraftError, draftToPayload, newDraftExercise, newRoutineDraft, parseDuration, parseRepRange, routineToDraft } from './draft'

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
