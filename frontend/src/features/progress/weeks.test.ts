import { describe, expect, it } from 'vitest'

import { canCheckIn, mondayFromParam, shiftWeek, thisMonday } from './weeks'

describe('weeks (Monday first, like the server)', () => {
  it('finds the Monday of any day', () => {
    expect(thisMonday(new Date(2026, 10, 18))).toBe('2026-11-16') // Wednesday
    expect(thisMonday(new Date(2026, 10, 22))).toBe('2026-11-16') // Sunday
    expect(thisMonday(new Date(2026, 10, 23))).toBe('2026-11-23') // Monday
  })

  it('moves by whole weeks, also across months and years', () => {
    expect(shiftWeek('2026-11-30', 1)).toBe('2026-12-07')
    expect(shiftWeek('2027-01-04', -1)).toBe('2026-12-28')
  })

  it('reads the week from the address, or falls back to this week', () => {
    const today = new Date(2026, 10, 18)
    expect(mondayFromParam('2026-11-12', today)).toBe('2026-11-09')
    expect(mondayFromParam('nope', today)).toBe('2026-11-16')
    expect(mondayFromParam(null, today)).toBe('2026-11-16')
  })

  it('allows a check-in for this week and the last eight, never a future one', () => {
    expect(canCheckIn('2026-11-16', '2026-11-16')).toBe(true)
    expect(canCheckIn('2026-09-21', '2026-11-16')).toBe(true)
    expect(canCheckIn('2026-09-14', '2026-11-16')).toBe(false)
    expect(canCheckIn('2026-11-23', '2026-11-16')).toBe(false)
  })
})
