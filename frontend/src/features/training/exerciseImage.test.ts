import { describe, expect, it } from 'vitest'

import { exerciseImageUrls } from './ExerciseImage'
import { EXERCISE_IMAGE_SLUGS } from './exerciseImages'

describe('exerciseImageUrls', () => {
  it('vežba iz biblioteke sa crtežom ima početni i završni položaj', () => {
    expect(exerciseImageUrls({ slug: 'bench-press', name: 'Bench', muscle: 'chest' })).toEqual(['/exercises/bench-press-1.svg', '/exercises/bench-press-2.svg'])
  })

  it('lična vežba, vežba bez crteža i stari zapis bez sluga nemaju sliku', () => {
    expect(exerciseImageUrls({ slug: null, name: 'Moja', muscle: 'legs' })).toBeNull()
    expect(exerciseImageUrls({ slug: 'treadmill-run', name: 'Traka', muscle: 'cardio' })).toBeNull()
    expect(exerciseImageUrls({ name: 'Stara', muscle: 'chest' })).toBeNull()
  })

  it('crteži postoje za 42 vežbe', () => {
    expect(EXERCISE_IMAGE_SLUGS.size).toBe(42)
  })
})
