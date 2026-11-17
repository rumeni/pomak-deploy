import { describe, expect, it } from 'vitest'

import type { OutboxRow } from '../../lib/db'
import { nextRoutine, sessionsWithPending } from './next'

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

  it('compares UTC and offset timestamps as instants', () => {
    expect(nextRoutine(routines, [
      s('a', '2026-11-16T21:00:00+01:00'),
      s('b', '2026-11-16T20:30:00.000Z'),
    ])?.id).toBe('c')
  })

  it('bez treninga prva rutina, bez rutina ništa', () => {
    expect(nextRoutine(routines, [])?.id).toBe('a')
    expect(nextRoutine([], [s('a', '2026-09-20T10:00:00Z')])).toBeNull()
  })
})

describe('home card with offline sessions', () => {
  const queued = (id: string, routineId: string, startedAt: string, overrides: Partial<OutboxRow> = {}): OutboxRow => ({
    id, ownerId: 'u1', queuedAt: startedAt, attempts: 0, error: null, exercises: [],
    payload: {
      id, routine_id: routineId, name: `Workout ${routineId}`, started_at: startedAt,
      finished_at: startedAt, plan_snapshot: null, feeling: null, notes: '', exercises: [],
    },
    ...overrides,
  })

  it('includes unfinished upload in today and moves the recommendation forward', () => {
    const recent = sessionsWithPending(
      [{ id: 'old', name: 'Workout A', routine_id: 'a', started_at: '2026-11-15T10:00:00Z' }],
      [queued('local', 'b', '2026-11-16T10:00:00Z')],
    )
    expect(recent.map((s) => s.id)).toEqual(['local', 'old'])
    expect(nextRoutine(routines, recent)?.id).toBe('c')
  })

  it('excludes duplicate uploads, failed posts and delete tombstones', () => {
    const recent = sessionsWithPending(
      [
        { id: 'sent', name: 'Sent', routine_id: 'a', started_at: '2026-11-16T10:00:00Z' },
        { id: 'deleting', name: 'Deleting', routine_id: 'b', started_at: '2026-11-16T11:00:00Z' },
      ],
      [
        queued('sent', 'a', '2026-11-16T10:00:00Z'),
        queued('deleting', 'b', '2026-11-16T11:00:00Z', { deleteRequested: true }),
        queued('rejected', 'c', '2026-11-16T12:00:00Z', { error: 'Invalid' }),
      ],
    )
    expect(recent.map((s) => s.id)).toEqual(['sent'])
  })
})
