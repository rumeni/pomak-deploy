import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))
const { comparePair, imagePath, toggleSelected } = await import('./photos')

const photo = (id: string, taken_on: string) => ({ id, taken_on, pose: 'front' as const, note: '', width: 1, height: 1 })

describe('progress photos', () => {
  it('compares two photos, the older one on the left', () => {
    const list = [photo('new', '2026-11-20'), photo('mid', '2026-10-01'), photo('old', '2026-09-01')]
    expect(comparePair(list, ['new', 'old'])!.map((p) => p.id)).toEqual(['old', 'new'])
    expect(comparePair(list, ['new'])).toBeNull()
  })

  it('a third pick replaces the earliest pick', () => {
    expect(toggleSelected([], 'a')).toEqual(['a'])
    expect(toggleSelected(['a', 'b'], 'c')).toEqual(['b', 'c'])
    expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('a coach reads a client’s photos through the coach address only', () => {
    expect(imagePath({ kind: 'own' }, 'p')).toBe('/progress/photos/p/image/')
    expect(imagePath({ kind: 'client', clientId: 'c' }, 'p')).toBe('/coach/clients/c/photos/p/image/')
  })
})
