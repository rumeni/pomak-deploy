import { describe, expect, it } from 'vitest'
import { setFormatLocale } from '../../lib/format'
import { formatCoachSet } from './formatCoach'

describe('formatCoachSet', () => {
  it('formats warmup as a prefix and avoids an empty multiplication separator', () => {
    setFormatLocale('sr-Latn-RS')
    expect(formatCoachSet({
      set_type: 'warmup', reps: 10, weight_kg: '62.50',
      duration_seconds: null, distance_m: null,
    }, 'Z:', 'pon.')).toBe('Z: 62,5 kg × 10 pon.')
  })

  it('removes insignificant zeros and preserves zero-weight exercises', () => {
    setFormatLocale('sr-Latn-RS')
    expect(formatCoachSet({
      set_type: 'working', reps: 12, weight_kg: '0.00',
      duration_seconds: null, distance_m: null,
    }, 'Z:', 'pon.')).toBe('0 kg × 12 pon.')
  })

  it('shows duration and distance when weight and reps are absent', () => {
    setFormatLocale('en-US')
    expect(formatCoachSet({
      set_type: 'working', reps: null, weight_kg: null,
      duration_seconds: 90, distance_m: 125.5,
    }, 'W:', 'reps')).toBe('90 s × 125.5 m')
  })
})
