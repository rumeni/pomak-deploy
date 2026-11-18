import { describe, expect, it } from 'vitest'

import { DraftError } from '../training/draft'
import { changeNotice, nextMonday, tailorDraft, tailoredRoutine, weekdayOf } from './plans'
import type { ClientPlan, PlanRoutine, PlanVersion } from './plansApi'

const routine: PlanRoutine = {
  id: 'r1', name: 'Upper A',
  exercises: [{
    exercise_id: 'e1', name: 'Bench', name_en: 'Bench press', measurement: 'weight_reps', rest_seconds: 120, notes: '',
    sets: [
      { set_type: 'warmup', reps_min: 10, reps_max: 10, weight_kg: '40.00', duration_seconds: null, distance_m: null, rpe: null },
      { set_type: 'working', reps_min: 8, reps_max: 10, weight_kg: '62.50', duration_seconds: null, distance_m: null, rpe: '8.0' },
    ],
  }],
}

const version = (patch: Partial<PlanVersion>): PlanVersion => ({
  id: 'v', name: 'Plan', reason: '', valid_from: '2026-11-23', valid_until: null, weeks: null, template_id: null,
  created_at: '2026-11-18T10:00:00Z', state: 'upcoming', days: [], ...patch,
})

describe('plans', () => {
  it('uses the server weekday (Monday = 0) and starts new programs next Monday', () => {
    expect(weekdayOf(new Date(2026, 10, 23))).toBe(0) // Monday
    expect(weekdayOf(new Date(2026, 10, 22))).toBe(6) // Sunday
    expect(nextMonday(new Date(2026, 10, 18))).toBe('2026-11-23') // Wednesday -> next Monday
    expect(nextMonday(new Date(2026, 10, 23))).toBe('2026-11-30') // Monday -> the one after
  })

  it('tells the client about the newest plan change of the last week, not older ones', () => {
    const now = new Date('2026-11-20T10:00:00Z')
    const plan: ClientPlan = {
      id: 'p', today: null, current_version_id: 'old',
      versions: [
        version({ id: 'old', state: 'current', created_at: '2026-11-01T10:00:00Z' }),
        version({ id: 'new', reason: 'Lakše', created_at: '2026-11-18T10:00:00Z' }),
      ],
    }
    expect(changeNotice(plan, now)?.id).toBe('new')
    expect(changeNotice({ ...plan, versions: [plan.versions[0]] }, now)).toBeNull()
    expect(changeNotice(null, now)).toBeNull()
  })

  it('adjusts a routine for one client: typed values become the server shape', () => {
    const draft = tailorDraft(routine, '(lično)')
    expect(draft.name).toBe('Upper A (lično)')
    expect(draft.exercises[0].sets[1]).toMatchObject({ reps: '8-10', weight: '62,5', rpe: '8' })
    draft.exercises[0].sets[1] = { ...draft.exercises[0].sets[1], reps: '5', weight: '55', rpe: '7,5' }
    const out = tailoredRoutine(draft)
    expect(out.exercises[0].sets[1]).toEqual({
      set_type: 'working', reps_min: 5, reps_max: 5, weight_kg: '55', duration_seconds: null, distance_m: null, rpe: '7.5',
    })
    expect(out.exercises[0].sets[0].set_type).toBe('warmup')
    expect(tailorDraft({ ...routine, name: 'Upper A (lično)' }, '(lično)').name).toBe('Upper A (lično)')
  })

  it('refuses invalid adjustments with the routine editor messages', () => {
    const draft = tailorDraft(routine, '(lično)')
    const bad = (patch: Partial<(typeof draft.exercises)[0]['sets'][0]>) => {
      const d = structuredClone(draft)
      d.exercises[0].sets[1] = { ...d.exercises[0].sets[1], ...patch }
      return () => tailoredRoutine(d)
    }
    expect(bad({ reps: '10-8' })).toThrow(DraftError)
    expect(bad({ weight: 'abc' })).toThrow(DraftError)
    expect(bad({ rpe: '11' })).toThrow(DraftError)
    expect(() => tailoredRoutine({ ...draft, name: ' ' })).toThrow(DraftError)
  })
})
