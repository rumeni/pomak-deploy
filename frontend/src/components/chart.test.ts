import { describe, expect, it } from 'vitest'

import { plot } from './chart'

describe('plot', () => {
  it('razmak po x prati datume, a y opseg ima malo prostora iznad i ispod', () => {
    const { points, min, max } = plot(
      [
        { date: '2026-09-01', value: 80 },
        { date: '2026-09-02', value: 90 },
        { date: '2026-09-11', value: 100 },
      ],
      100,
      50,
    )
    expect(points.map((p) => p.x)).toEqual([0, 10, 100])
    expect([min, max]).toEqual([78, 102])
    expect(points[0].y).toBeCloseTo(50 - (2 / 24) * 50)
    expect(points[2].y).toBeCloseTo((2 / 24) * 50)
  })

  it('jedna tačka je na sredini, ista vrednost ne deli nulom', () => {
    const { points } = plot([{ date: '2026-09-01', value: 80 }], 100, 50)
    expect(points[0].x).toBe(50)
    expect(Number.isFinite(points[0].y)).toBe(true)
  })

  it('preko letnjeg računanja vremena dani ostaju celi', () => {
    const { points } = plot(
      [
        { date: '2026-10-24', value: 1 },
        { date: '2026-10-25', value: 2 },
        { date: '2026-10-26', value: 3 },
      ],
      2,
      10,
    )
    expect(points.map((p) => Math.round(p.x * 100) / 100)).toEqual([0, 1, 2])
  })
})
