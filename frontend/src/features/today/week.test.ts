import { describe, expect, it } from 'vitest'

import { weekActivity } from './week'

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
