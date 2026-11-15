import { describe, expect, it } from 'vitest'

import { nextRoutine } from './next'

const routines = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const s = (routine_id: string | null, started_at: string) => ({ routine_id, started_at })

describe('nextRoutine', () => {
  it('posle poslednje odrađene ide sledeća, ukrug', () => {
    expect(nextRoutine(routines, [s('a', '2026-09-20T10:00:00Z'), s('b', '2026-09-25T10:00:00Z')])?.id).toBe('c')
    expect(nextRoutine(routines, [s('c', '2026-09-28T10:00:00Z'), s('a', '2026-09-20T10:00:00Z')])?.id).toBe('a')
  })

  it('slobodan trening i obrisane rutine se ne računaju', () => {
    expect(nextRoutine(routines, [s(null, '2026-09-29T10:00:00Z'), s('x', '2026-09-28T10:00:00Z'), s('a', '2026-09-20T10:00:00Z')])?.id).toBe('b')
  })

  it('bez treninga prva rutina, bez rutina ništa', () => {
    expect(nextRoutine(routines, [])?.id).toBe('a')
    expect(nextRoutine([], [s('a', '2026-09-20T10:00:00Z')])).toBeNull()
  })
})
