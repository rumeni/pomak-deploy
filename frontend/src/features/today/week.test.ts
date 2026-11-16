import { describe, expect, it } from 'vitest'

import { progressDate, weekActivity, workoutCountWithPending } from './week'

// Podne po lokalnom vremenu, da datum ne zavisi od vremenske zone na kojoj test radi.
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString()
const s = (id: string, day: string, status: 'sent' | 'pending' | 'rejected' = 'sent') => ({ id, startedAt: at(day), status })

describe('weekActivity', () => {
  it('nedelja ima 7 dana od ponedeljka', () => {
    expect(weekActivity([], [], '2026-11-09').days).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ])
  })

  it('neposlat trening označava dan i broji se, odbijen ne', () => {
    const r = weekActivity([s('a', '2026-11-10')], [s('b', '2026-11-12', 'pending'), s('c', '2026-11-13', 'rejected')], '2026-11-09')
    expect([...r.trained].sort()).toEqual(['2026-11-10', '2026-11-12'])
    expect(r.unsentThisWeek).toBe(1)
  })

  it('trening koji je već na serveru se ne broji dvaput', () => {
    const r = weekActivity([s('a', '2026-11-10')], [s('a', '2026-11-10', 'pending')], '2026-11-09')
    expect(r.unsentThisWeek).toBe(0)
  })

  it('neposlat trening iz prethodne nedelje se ne dodaje ovoj', () => {
    expect(weekActivity([], [s('b', '2026-11-08', 'pending')], '2026-11-09').unsentThisWeek).toBe(0)
  })
})

describe('workout count with offline pending sessions', () => {
  it('shows pending workouts without a server summary', () => {
    expect(workoutCountWithPending(undefined, 2)).toBe(2)
  })
  it('keeps the placeholder if neither server data nor local workouts are available', () => {
    expect(workoutCountWithPending(undefined, 0)).toBeNull()
  })
  it('combines a server count and unsent sessions without dropping zero', () => {
    expect(workoutCountWithPending(3, 2)).toBe(5)
    expect(workoutCountWithPending(0, 0)).toBe(0)
  })
})

describe('weekly boundaries match the backend Europe/Belgrade timezone', () => {
  it('counts Monday 00:30 Belgrade time in the new week even when it is Sunday in New York', () => {
    const startedAt = '2026-11-15T23:30:00Z'
    expect(progressDate(new Date(startedAt))).toBe('2026-11-16')
    const result = weekActivity([], [{ id: 'local', startedAt, status: 'pending' }], '2026-11-16')
    expect(result.unsentThisWeek).toBe(1)
    expect(result.trained.has('2026-11-16')).toBe(true)
  })
  it('excludes Sunday 23:30 Belgrade time from the following week', () => {
    const result = weekActivity([], [{ id: 'earlier', startedAt: '2026-11-15T22:30:00Z', status: 'pending' }], '2026-11-16')
    expect(result.unsentThisWeek).toBe(0)
    expect(result.trained.has('2026-11-16')).toBe(false)
  })
  it('handles summer time using the same IANA timezone', () => {
    expect(progressDate(new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30')
  })
})
