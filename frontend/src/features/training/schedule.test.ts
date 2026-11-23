import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))
const { scheduledToday } = await import('./schedule')

describe("today's routine from the athlete's own week", () => {
  const week = { days: [{ weekday: 0 as const, routine_id: 'a', name: 'A' }, { weekday: 3 as const, routine_id: 'b', name: 'B' }] }

  it('a planned day gives its routine, another day is a rest day', () => {
    expect(scheduledToday(week, 3)).toBe('b')
    expect(scheduledToday(week, 1)).toBeNull()
  })

  it('without a week (or before it loads) nothing is planned', () => {
    expect(scheduledToday({ days: [] }, 0)).toBeUndefined()
    expect(scheduledToday(undefined, 0)).toBeUndefined()
  })
})
