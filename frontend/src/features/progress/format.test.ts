import { describe, expect, it } from 'vitest'

import type { Measurement } from './api'
import { formatRecordValue, measurementPoints } from './format'

const m = (measured_on: string, value: string, created_at: string): Measurement => ({
  id: created_at, kind: 'weight', value, unit: 'kg', measured_on, note: '', created_at,
})

describe('measurementPoints', () => {
  it('jedno merenje po danu (poslednje upisano), od najstarijeg', () => {
    // Server vraća od najnovijeg
    const list = [m('2026-09-20', '80.1', 't4'), m('2026-09-20', '80.6', 't3'), m('2026-09-10', '81.0', 't2'), m('2026-09-01', '82.4', 't1')]
    expect(measurementPoints(list)).toEqual([
      { date: '2026-09-01', value: 82.4 },
      { date: '2026-09-10', value: 81 },
      { date: '2026-09-20', value: 80.1 },
    ])
  })
})

describe('formatRecordValue', () => {
  it('prikazuje jedinicu po vrsti rekorda', () => {
    expect(formatRecordValue('heaviest', '82.50', 'pon.')).toBe('82,5 kg')
    expect(formatRecordValue('most_reps', 12, 'pon.')).toBe('12 pon.')
    expect(formatRecordValue('longest_distance', 5230, 'pon.')).toBe('5,23 km')
  })
})
