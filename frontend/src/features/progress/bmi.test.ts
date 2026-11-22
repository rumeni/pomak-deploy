import { describe, expect, it } from 'vitest'
import { adultBmi } from './bmi'

const date = '2026-11-22'
const birthday = '1990-03-19'

describe('adultBmi', () => {
  it('shows all adult classes at exact thresholds', () => {
    for (const [weight, value, category] of [
      [70, 17.5, 'underweight'], [74, 18.5, 'healthy'],
      [100, 25, 'overweight'], [120, 30, 'obesity1'],
      [140, 35, 'obesity2'], [160, 40, 'obesity3'],
    ] as const) {
      expect(adultBmi(weight, 200, birthday, date)).toEqual({ value, category })
    }
    expect(adultBmi(77.5, 180, birthday, date)?.value).toBe(23.9)
  })

  it('uses unrounded BMI for classification immediately below each boundary', () => {
    for (const [weight, displayed, category] of [
      [73.9, 18.4, 'underweight'],
      [99.9, 24.9, 'healthy'],
      [119.9, 29.9, 'overweight'],
      [139.9, 34.9, 'obesity1'],
      [159.9, 39.9, 'obesity2'],
    ] as const) {
      expect(adultBmi(weight, 200, birthday, date)).toEqual({ value: displayed, category })
    }
  })

  it('never displays a value that contradicts its category', () => {
    // 50–130 kg at 180 cm spans BMI 15.4–40.1, i.e. every category and boundary.
    for (let tenths = 500; tenths <= 1300; tenths++) {
      const bmi = adultBmi(tenths / 10, 180, birthday, date)!
      const shown = bmi.value
      const expected = shown < 18.5 ? 'underweight' : shown < 25 ? 'healthy' : shown < 30 ? 'overweight'
        : shown < 35 ? 'obesity1' : shown < 40 ? 'obesity2' : 'obesity3'
      expect(bmi.category).toBe(expected)
    }
  })

  it('ignores floating-point noise at exact values', () => {
    expect(adultBmi(77.76, 180, birthday, date)).toEqual({ value: 24, category: 'healthy' })
    expect(adultBmi(81, 180, birthday, date)).toEqual({ value: 25, category: 'overweight' })
  })

  it('checks age on the date of the recorded weight', () => {
    expect(adultBmi(80, 180, '2006-11-23', date)).toBeNull()
    expect(adultBmi(80, 180, '2006-11-22', date)).not.toBeNull()
    expect(adultBmi(80, 180, '2006-11-22', '2026-11-21')).toBeNull()
  })

  it('does not display a BMI from invalid inputs', () => {
    expect(adultBmi(80, 0, birthday, date)).toBeNull()
    expect(adultBmi(NaN, 180, birthday, date)).toBeNull()
    expect(adultBmi(-20, 180, birthday, date)).toBeNull()
    expect(adultBmi(80, 180, null, date)).toBeNull()
    expect(adultBmi(80, 180, '2026-02-30', date)).toBeNull()
    expect(adultBmi(80, 180, '2028-01-01', date)).toBeNull()
    expect(adultBmi(80, 180, birthday, '2026-11-32')).toBeNull()
  })
})
