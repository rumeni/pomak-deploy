import { describe, expect, it } from 'vitest'

import { mondayOf } from './week'

describe('mondayOf', () => {
  it('nedelja počinje ponedeljkom', () => {
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
    expect(mondayOf('2026-09-30')).toBe('2026-09-28')
    expect(mondayOf('2026-10-04')).toBe('2026-09-28')
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
  })

  it('preko promene na zimsko vreme', () => {
    expect(mondayOf('2026-10-25')).toBe('2026-10-19')
  })
})
