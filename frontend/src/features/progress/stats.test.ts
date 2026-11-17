import { describe, expect, it } from 'vitest'

import { EMPTY_READINESS } from '../workout/rpe'
import { pickBar } from '../../components/chart'
import { answerCount, change, perWeek, readinessComparison, readinessSeries, rpeChange, type ReadinessEntry } from './stats'

const entry = (date: string, readiness: Partial<typeof EMPTY_READINESS>, sets: number, avgRpe: string | null, rpeSets: number, rpeSum?: string): ReadinessEntry => ({
  session_id: date, date, name: 'T', readiness: { ...EMPTY_READINESS, ...readiness },
  working_sets: sets, volume_kg: '0', avg_rpe: avgRpe, rpe_sets: rpeSets,
  rpe_sum: rpeSum ?? String(avgRpe ? Number(avgRpe) * rpeSets : 0),
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

describe('review follow-ups', () => {
  it('keeps the bar selection by key and falls back to the last bar after a shorter period', () => {
    const long = Array.from({ length: 13 }, (_, i) => ({ key: `w${i}`, value: i }))
    expect(pickBar(long, 'w11')?.key).toBe('w11')
    // Switching from 90 days to 7: the selected late week is gone, never undefined.
    expect(pickBar(long.slice(-2), 'w3')?.key).toBe('w12')
    expect(pickBar([], 'w3')).toBeNull()
  })

  it('averages per week over the real period, not chart bars', () => {
    expect(perWeek(520, 365)).toBeCloseTo(9.97, 2) // a year of history, though only 26 bars are shown
    expect(perWeek(12, 7)).toBe(12) // seven days crossing a Monday are still one week
    expect(perWeek(6, 3)).toBe(6) // shorter than a week counts as one
  })

  it('compares RPE in points only when both periods have it', () => {
    expect(rpeChange('8.3', '7.9')).toBe(0.4)
    expect(rpeChange('7.5', '8.0')).toBe(-0.5)
    expect(rpeChange('8.0', null)).toBeNull()
    expect(rpeChange(null, '8.0')).toBeNull()
  })

  it('weights RPE by exact sums, not rounded workout averages', () => {
    // Workout averages 8.33 and 7.67 would round to 8.3 and 7.7 on their own.
    const rows = [1, 2, 3].flatMap((d) => [
      entry(`2026-11-0${d}`, fresh, 10, '8.3', 3, '25'),
      entry(`2026-11-1${d}`, tired, 10, '7.7', 3, '23'),
    ])
    const result = readinessComparison(rows)
    expect(result.high.avgRpe).toBeCloseTo(25 / 3, 6)
    expect(result.low.avgRpe).toBeCloseTo(23 / 3, 6)
  })
})

