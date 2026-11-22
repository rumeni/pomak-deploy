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
