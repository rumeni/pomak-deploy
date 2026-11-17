import { describe, expect, it } from 'vitest'

import {
  estimated1rm,
  formatRpe,
  parseRpe,
  percentOf1rm,
  readinessBand,
  readinessScore,
  repsInReserve,
  weightForTarget,
} from './rpe'

describe('RPE', () => {
  it('parses only values on the half-step scale', () => {
    expect(parseRpe('8.0')).toBe(8)
    expect(parseRpe('7,5')).toBe(7.5)
    expect(parseRpe(9.5)).toBe(9.5)
    expect(parseRpe('8.3')).toBeNull()
    expect(parseRpe('11')).toBeNull()
    expect(parseRpe('')).toBeNull()
    expect(parseRpe(null)).toBeNull()
  })

  it('reads the percentage chart', () => {
    expect(percentOf1rm(1, 10)).toBe(1)
    expect(percentOf1rm(5, 8)).toBe(0.81)
    expect(percentOf1rm(11, 8)).toBeNull()
  })

  it('estimates 1RM from the chart at RPE 6+, otherwise with Epley', () => {
    expect(estimated1rm(100, 5, 8)).toBeCloseTo(123.46, 2)
    expect(estimated1rm(90, 3, 5)).toBeCloseTo(99, 5) // RPE 5 is too easy to trust the chart
    expect(estimated1rm(60, 10, null)).toBeCloseTo(80, 5)
    expect(estimated1rm(100, 1, null)).toBe(100)
    expect(estimated1rm(50, 20, 8)).toBeNull()
    expect(estimated1rm(0, 5, 8)).toBeNull()
  })

  it('suggests a loadable weight for a prescribed set', () => {
    // e1RM 123.5: 3 reps @ 8 = 86% -> 106.2 -> 105 on a barbell, 106 in 1 kg steps
    expect(weightForTarget(123.5, 3, 8, 2.5)).toBe(105)
    expect(weightForTarget(123.5, 3, 8, 1)).toBe(106)
    expect(weightForTarget(123.5, 12, 8, 2.5)).toBeNull()
  })

  it('describes reps in reserve', () => {
    expect(repsInReserve(10)).toBeNull()
    expect(repsInReserve(8)).toEqual({ min: 2, max: 2 })
    expect(repsInReserve(7.5)).toEqual({ min: 2, max: 3 })
    expect(formatRpe(7.5)).toBe('7,5')
    expect(formatRpe(8)).toBe('8')
  })
})

describe('readiness score', () => {
  it('is null without answers and uses only what was answered', () => {
    expect(readinessScore(null)).toBeNull()
    expect(readinessScore({ motivation: null })).toBeNull()
    expect(readinessScore({ motivation: 5 })).toBe(100)
    expect(readinessScore({ stress: 5 })).toBe(0)
  })

  it('counts stress and soreness in reverse and maps sleep hours', () => {
    const tired = { sleep_hours: 5, hydration: 3, stress: 4, motivation: 2, soreness_upper: 4, soreness_lower: 5 }
    // sleep 2, hydration 3, stress 2, motivation 2, soreness 2 and 1 -> avg 2 -> 25
    expect(readinessScore(tired)).toBe(25)
    const fresh = { sleep_hours: 8, hydration: 4, stress: 2, motivation: 4, soreness_upper: 1, soreness_lower: 2 }
    expect(readinessScore(fresh)).toBe(83)
    expect(readinessBand(25)).toBe('low')
    expect(readinessBand(60)).toBe('ok')
    expect(readinessBand(83)).toBe('high')
  })
})
