import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))
const { comparePair, forgetClientPhotos, imagePath, toggleSelected } = await import('./photos')

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
    // Fetched pictures are tied to the access version they were allowed under.
    expect(imagePath({ kind: 'client', clientId: 'c', accessVersion: 3 }, 'p')).toBe('/coach/clients/c/photos/p/image/?v=3')
  })

  it('losing access forgets the client’s photo list and every fetched picture, nothing else', () => {
    const qc = new QueryClient()
    qc.setQueryData(['progress-photos', 'coach', 'c', 3], [photo('p', '2026-11-01')])
    qc.setQueryData(['coach-picture', 'coach', '/coach/clients/c/photos/p/image/?v=3'], new Blob(['x']))
    qc.setQueryData(['progress-photos', 'coach', 'other', 1], [])
    qc.setQueryData(['coach-picture', 'coach', '/coach/photos/coach-1/'], new Blob(['me']))
    qc.setQueryData(['progress-photos', 'coach', 'own'], [])
    forgetClientPhotos(qc, 'c')
    expect(qc.getQueryData(['progress-photos', 'coach', 'c', 3])).toBeUndefined()
    expect(qc.getQueryData(['coach-picture', 'coach', '/coach/clients/c/photos/p/image/?v=3'])).toBeUndefined()
    expect(qc.getQueryData(['progress-photos', 'coach', 'other', 1])).toEqual([])
    expect(qc.getQueryData(['coach-picture', 'coach', '/coach/photos/coach-1/'])).toBeInstanceOf(Blob)
    expect(qc.getQueryData(['progress-photos', 'coach', 'own'])).toEqual([])
  })
})
