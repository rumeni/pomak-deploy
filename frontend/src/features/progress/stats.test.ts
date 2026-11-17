import { describe, expect, it } from 'vitest'

import { EMPTY_READINESS } from '../workout/rpe'
import { answerCount, change, readinessComparison, readinessSeries, type ReadinessEntry } from './stats'

const entry = (date: string, readiness: Partial<typeof EMPTY_READINESS>, sets: number, avgRpe: string | null, rpeSets: number): ReadinessEntry => ({
  session_id: date, date, name: 'T', readiness: { ...EMPTY_READINESS, ...readiness },
  working_sets: sets, volume_kg: '0', avg_rpe: avgRpe, rpe_sets: rpeSets,
})

const fresh = { sleep_hours: 8, motivation: 5, stress: 1 } // score 100
const tired = { sleep_hours: 5, motivation: 2, stress: 4 } // score 25

describe('statistics helpers', () => {
  it('compares with the previous period, without a percentage from zero', () => {
    expect(change(12, 10)).toEqual({ diff: 2, pct: 20 })
    expect(change(3, 0)).toEqual({ diff: 3, pct: null })
    expect(change(5, null)).toBeNull()
  })

  it('counts answers and builds series that skip unanswered workouts', () => {
    expect(answerCount({ ...EMPTY_READINESS, stress: 2, sleep_hours: 7 })).toBe(2)
    const entries = [entry('2026-11-01', { sleep_hours: 7 }, 10, null, 0), entry('2026-11-03', { stress: 3 }, 8, null, 0)]
    expect(readinessSeries(entries, 'sleep_hours')).toEqual([{ date: '2026-11-01', value: 7 }])
    expect(readinessSeries(entries, 'score').map((p) => p.date)).toEqual(['2026-11-01', '2026-11-03'])
  })

  it('compares high and low readiness workouts, RPE weighted by sets that have it', () => {
    const entries = [
      entry('2026-11-01', fresh, 18, '8.0', 10),
      entry('2026-11-02', fresh, 20, '7.0', 10),
      entry('2026-11-03', fresh, 16, null, 0),
      entry('2026-11-04', tired, 12, '9.0', 4),
      entry('2026-11-05', tired, 10, '8.0', 12),
    ]
    const result = readinessComparison(entries)
    expect(result.high).toEqual({ count: 3, avgSets: 18, avgRpe: 7.5 })
    expect(result.low.count).toBe(2)
    expect(result.low.avgRpe).toBeCloseTo(8.25, 5)
    // Two low days are too few to say anything.
    expect(result.enough).toBe(false)
    expect(readinessComparison([...entries, entry('2026-11-06', tired, 9, null, 0)]).enough).toBe(true)
  })
})
