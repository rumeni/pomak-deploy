import { describe, expect, it } from 'vitest'

import { addDays, dayKey, groupByDay, localMoment, mondayOf, rangesOverlap, weekDays, weekdayOf } from './time'

describe('calendar dates', () => {
  it('weeks start on Monday, as on the server', () => {
    expect(mondayOf('2026-11-19')).toBe('2026-11-16') // Thursday
    expect(mondayOf('2026-11-22')).toBe('2026-11-16') // Sunday
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
    expect(weekDays('2026-11-16')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'])
    expect(weekdayOf('2026-11-16')).toBe(0)
    expect(weekdayOf('2026-11-22')).toBe(6)
  })

  it('crosses months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('a local date and time round-trip to the same local day', () => {
    const moment = localMoment('2026-11-24', '09:30')
    expect(dayKey(moment)).toBe('2026-11-24')
    expect(new Date(moment).getHours()).toBe(9)
    expect(new Date(moment).getMinutes()).toBe(30)
  })

  it('groups by local day in time order', () => {
    const items = [localMoment('2026-11-24', '11:00'), localMoment('2026-11-24', '08:00'), localMoment('2026-11-25', '09:00')]
    const days = groupByDay(items, (x) => x)
    expect([...days.keys()]).toEqual(['2026-11-24', '2026-11-25'])
    expect(days.get('2026-11-24')).toEqual([items[1], items[0]])
  })

  it('touching ranges do not overlap', () => {
    expect(rangesOverlap({ start: '08:00', end: '12:00' }, { start: '12:00', end: '14:00' })).toBe(false)
    expect(rangesOverlap({ start: '08:00', end: '12:00' }, { start: '11:00', end: '14:00' })).toBe(true)
  })
})
