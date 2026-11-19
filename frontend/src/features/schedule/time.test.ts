import { describe, expect, it } from 'vitest'

import { addDays, dayKey, groupByDay, mondayOf, onDay, rangesOverlap, slotLabels, spanOnDay, timeLabel, validDayTime, weekDays, weekdayOf, zonedMoment } from './time'

describe('schedule dates (Europe/Belgrade, whatever the device zone)', () => {
  it('weeks start on Monday, as on the server', () => {
    expect(mondayOf('2026-11-19')).toBe('2026-11-16')
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')
    expect(weekDays('2026-11-16')[6]).toBe('2026-11-22')
    expect(weekdayOf('2026-11-16')).toBe(0)
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
  })

  it('a typed time is a Belgrade time, also from a device in another zone', () => {
    expect(zonedMoment('2026-11-24', '09:30')).toBe('2026-11-24T08:30:00.000Z') // CET
    expect(zonedMoment('2027-06-01', '09:30')).toBe('2027-06-01T07:30:00.000Z') // CEST
    expect(timeLabel('2026-11-24T08:30:00.000Z')).toBe('09:30')
    expect(dayKey('2026-11-23T23:30:00.000Z')).toBe('2026-11-24') // already the 24th in Belgrade
    // The same instant shown for a device in New York would be another day there.
    expect(dayKey('2026-11-23T23:30:00.000Z', 'America/New_York')).toBe('2026-11-23')
  })

  it('clock changes match the server', () => {
    expect(zonedMoment('2027-03-28', '02:30')).toBe('2027-03-28T01:30:00.000Z') // skipped: 03:30 CEST
    expect(zonedMoment('2027-03-28', '03:00')).toBe('2027-03-28T01:00:00.000Z')
    expect(zonedMoment('2027-10-31', '02:30')).toBe('2027-10-31T00:30:00.000Z') // repeated: the first one
  })

  it('a multi-day closure shows on every day it covers, clipped', () => {
    const closure = { starts_at: zonedMoment('2026-11-14', '00:00'), ends_at: zonedMoment('2026-11-18', '12:00') }
    const items = [closure]
    for (const day of ['2026-11-16', '2026-11-17', '2026-11-18']) {
      expect(onDay(items, day, (x) => x.starts_at, (x) => x.ends_at)).toEqual(items)
    }
    expect(onDay(items, '2026-11-19', (x) => x.starts_at, (x) => x.ends_at)).toEqual([])
    expect(spanOnDay(closure.starts_at, closure.ends_at, '2026-11-17')).toEqual({ wholeDay: true, from: null, to: null })
    expect(spanOnDay(closure.starts_at, closure.ends_at, '2026-11-18')).toEqual({ wholeDay: false, from: null, to: '12:00' })
  })

  it('groups by schedule day in time order', () => {
    const items = [zonedMoment('2026-11-24', '11:00'), zonedMoment('2026-11-24', '08:00'), zonedMoment('2026-11-25', '09:00')]
    const days = groupByDay(items, (x) => x)
    expect([...days.keys()]).toEqual(['2026-11-24', '2026-11-25'])
    expect(days.get('2026-11-24')).toEqual([items[1], items[0]])
  })

  it('validates ranges and typed values', () => {
    expect(rangesOverlap({ start: '08:00', end: '12:00' }, { start: '12:00', end: '14:00' })).toBe(false)
    expect(rangesOverlap({ start: '08:00', end: '12:00' }, { start: '11:00', end: '14:00' })).toBe(true)
    expect(validDayTime('', '09:00')).toBe(false)
    expect(validDayTime('2026-11-24', '')).toBe(false)
    expect(validDayTime('2026-11-24', '09:00')).toBe(true)
  })
})

describe('slot labels', () => {
  it('the hour repeated in autumn shows two distinguishable times', () => {
    const first = zonedMoment('2027-10-31', '02:30') // CEST
    const second = new Date(Date.parse(first) + 3600_000).toISOString() // the same wall time, CET
    const labels = slotLabels([first, second, zonedMoment('2027-10-31', '04:00')])
    expect(labels[0].label).not.toBe(labels[1].label)
    expect(labels[2].label).toBe('04:00')
  })
})
