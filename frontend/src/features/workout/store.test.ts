import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { setCurrentUserId } from '../../lib/currentUser'
import { db } from '../../lib/db'
import { startEmpty, type ActiveWorkout, type SessionPayload } from './model'
import { finishWorkout } from './outbox'
import { applyActiveWorkoutEdit, clearActiveWorkout, getActiveWorkoutRow, persistActiveWorkoutIfCurrent, saveActiveWorkout, StaleWorkoutError, startWorkoutIfUnchanged } from './store'
import { ConcurrentWorkoutEditError } from './mergeWorkout'

beforeEach(async () => {
  await db.activeWorkout.clear()
  await db.outbox.clear()
  setCurrentUserId(null)
})

describe('per-account active workout persistence', () => {
  it('a forced sign-out and account switch cannot overwrite a previous workout', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout({ id: 'A', name: 'A unfinished' } as ActiveWorkout)
    setCurrentUserId(null) // token revoked without the profile logout confirmation

    setCurrentUserId('u2')
    expect(await getActiveWorkoutRow()).toBeNull()
    await saveActiveWorkout({ id: 'B', name: 'B unfinished' } as ActiveWorkout)
    expect((await getActiveWorkoutRow())?.workout.id).toBe('B')

    setCurrentUserId('u1')
    expect((await getActiveWorkoutRow())?.workout.id).toBe('A')
    await clearActiveWorkout('u1', 'A')
    expect(await db.activeWorkout.get('u1')).toBeUndefined()
    expect((await db.activeWorkout.get('u2'))?.workout.id).toBe('B')
  })
})

describe('late autosave regression (#41)', () => {
  const date = new Date('2026-09-30T10:00:00Z')
  const payload = (id: string): SessionPayload => ({
    id, routine_id: null, name: 'Done', started_at: date.toISOString(),
    finished_at: date.toISOString(), plan_snapshot: null, feeling: null,
    notes: '', exercises: [],
  })

  it('updates only the original unfinished workout', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout(startEmpty('Workout A', date))
    const original = (await db.activeWorkout.get('u1'))!
    const edited = { ...original, workout: { ...original.workout, name: 'Last confirmed set' } }
    expect(await persistActiveWorkoutIfCurrent(edited)).toBe(true)
    expect((await getActiveWorkoutRow())?.workout.name).toBe('Last confirmed set')

    await finishWorkout('u1', payload(original.workout.id), [])
    // Simulate the async previous-results call completing after Finish.
    expect(await persistActiveWorkoutIfCurrent(edited)).toBe(false)
    expect(await db.activeWorkout.get('u1')).toBeUndefined()
    expect((await db.outbox.get(original.workout.id))?.payload.name).toBe('Done')
  })

  it('never overwrites a replacement workout or resurrects a discarded one', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout(startEmpty('A', date))
    const stale = (await db.activeWorkout.get('u1'))!
    const B = startEmpty('B', new Date('2026-09-30T11:00:00Z'))
    await saveActiveWorkout(B)
    expect(await persistActiveWorkoutIfCurrent({ ...stale, workout: { ...stale.workout, name: 'stale response' } })).toBe(false)
    expect((await getActiveWorkoutRow())?.workout.id).toBe(B.id)

    const pending = persistActiveWorkoutIfCurrent({ slot: 'u1', ownerId: 'u1', workout: { ...B, name: 'late edit' } })
    await clearActiveWorkout('u1', B.id)
    await pending
    expect(await db.activeWorkout.get('u1')).toBeUndefined()
    expect(await persistActiveWorkoutIfCurrent({ slot: 'u1', ownerId: 'u1', workout: B })).toBe(false)
  })

  it('cannot persist a stale edit after an account switch', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout(startEmpty('A', date))
    const old = (await db.activeWorkout.get('u1'))!
    setCurrentUserId('u2')
    expect(await persistActiveWorkoutIfCurrent({ ...old, workout: { ...old.workout, name: 'stale' } })).toBe(false)
    expect((await db.activeWorkout.get('u1'))?.workout.name).toBe('A')
  })
})


describe('atomic workout start regression (#46)', () => {
  const date = new Date('2026-11-16T13:00:00Z')

  it('keeps the first start when two routines finish loading in reverse order', async () => {
    setCurrentUserId('u1')
    const originalId: string | null = (await getActiveWorkoutRow())?.workout.id ?? null
    let finishSlow!: () => void
    const slow = new Promise<void>((resolve) => { finishSlow = resolve })
    const A = startEmpty('Routine A', date)
    const B = startEmpty('Routine B', date)
    const startA = (async () => {
      await slow // simulated slow loadPrevious
      return startWorkoutIfUnchanged(A, originalId, 'u1')
    })()
    const second = await startWorkoutIfUnchanged(B, originalId, 'u1')
    expect(second).toBe(true)
    finishSlow()
    expect(await startA).toBe(false)
    expect((await getActiveWorkoutRow())?.workout.id).toBe(B.id)
  })

  it('cannot replace a workout that another tab created while loading previous sets', async () => {
    setCurrentUserId('u1')
    const A = startEmpty('A', date)
    await saveActiveWorkout(A)
    const expected = (await getActiveWorkoutRow())!.workout.id
    await saveActiveWorkout(startEmpty('Newer B', date))
    const replacement = startEmpty('Stale C', date)
    expect(await startWorkoutIfUnchanged(replacement, expected, 'u1')).toBe(false)
    expect((await getActiveWorkoutRow())?.workout.name).toBe('Newer B')
  })

  it('honors intentional replacement, without writing to another account', async () => {
    setCurrentUserId('u1')
    const A = startEmpty('A', date)
    await saveActiveWorkout(A)
    expect(await startWorkoutIfUnchanged(startEmpty('B', date), A.id, 'u1')).toBe(true)
    const kept = (await db.activeWorkout.get('u1'))!.workout.id
    setCurrentUserId('u2')
    expect(await startWorkoutIfUnchanged(startEmpty('C', date), kept, 'u1')).toBe(false)
    expect((await db.activeWorkout.get('u1'))?.workout.id).toBe(kept)
    expect(await db.activeWorkout.get('u2')).toBeUndefined()
  })
})

describe('atomic discard of the expected workout only (#51)', () => {
  const date = new Date('2026-11-16T13:00:00Z')

  it('cannot delete B using A from a stale tab', async () => {
    setCurrentUserId('u1')
    const A = startEmpty('A', date)
    await saveActiveWorkout(A)
    const B = startEmpty('B', date)
    await saveActiveWorkout(B)
    await expect(clearActiveWorkout('u1', A.id)).rejects.toBeInstanceOf(StaleWorkoutError)
    expect((await db.activeWorkout.get('u1'))?.workout.id).toBe(B.id)
    await clearActiveWorkout('u1', B.id)
    expect(await db.activeWorkout.get('u1')).toBeUndefined()
  })

  it('refuses to erase a workout after its session or owner changed', async () => {
    setCurrentUserId('u1')
    const A = startEmpty('A', date)
    await saveActiveWorkout(A)
    setCurrentUserId('u2')
    await expect(clearActiveWorkout('u1', A.id)).rejects.toBeInstanceOf(StaleWorkoutError)
    expect((await db.activeWorkout.get('u1'))?.workout.id).toBe(A.id)
    setCurrentUserId('u1')
    await expect(clearActiveWorkout('u1', 'nonexistent')).rejects.toBeInstanceOf(StaleWorkoutError)
    expect((await db.activeWorkout.get('u1'))?.workout.id).toBe(A.id)
  })

  it('refuses to remove an already-finished or missing active workout', async () => {
    setCurrentUserId('u1')
    await expect(clearActiveWorkout('u1', 'A')).rejects.toBeInstanceOf(StaleWorkoutError)
    expect(await db.activeWorkout.count()).toBe(0)
  })
})

describe('atomic same-workout edits across browser tabs', () => {
  const now = new Date('2026-11-16T13:00:00Z')
  it('preserves independent fields from two stale snapshots', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout(startEmpty('A', now))
    const base = (await getActiveWorkoutRow())!.workout
    await Promise.all([
      applyActiveWorkoutEdit('u1', base.id, base, { ...base, name: 'Renamed' }),
      applyActiveWorkoutEdit('u1', base.id, base, { ...base, draftNotes: 'Some note' }),
    ])
    const saved = (await getActiveWorkoutRow())!
    expect(saved.workout.name).toBe('Renamed')
    expect(saved.workout.draftNotes).toBe('Some note')
    expect(saved.revision).toBe(2)
  })
  it('rejects competing edits of the same field instead of overwriting', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout(startEmpty('A', now))
    const base = (await getActiveWorkoutRow())!.workout
    await applyActiveWorkoutEdit('u1', base.id, base, { ...base, name: 'First' })
    await expect(applyActiveWorkoutEdit('u1', base.id, base, { ...base, name: 'Second' }))
      .rejects.toBeInstanceOf(ConcurrentWorkoutEditError)
    expect((await getActiveWorkoutRow())?.workout.name).toBe('First')
  })
  it('cannot finish a stale revision of the same workout', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout(startEmpty('A', now))
    const old = (await getActiveWorkoutRow())!
    await applyActiveWorkoutEdit('u1', old.workout.id, old.workout, { ...old.workout, name: 'Updated' })
    const payload: SessionPayload = {
      id: old.workout.id, routine_id: null, name: 'A',
      started_at: now.toISOString(), finished_at: now.toISOString(),
      plan_snapshot: null, feeling: null, notes: '', exercises: [],
    }
    await expect(finishWorkout('u1', payload, [], new Date(), old.revision ?? 0))
      .rejects.toBeInstanceOf(StaleWorkoutError)
    expect((await getActiveWorkoutRow())?.workout.name).toBe('Updated')
    expect(await db.outbox.get(old.workout.id)).toBeUndefined()
  })
  it('cannot replace a workout if new sets arrived after confirmation', async () => {
    setCurrentUserId('u1')
    await saveActiveWorkout(startEmpty('A', now))
    const old = (await getActiveWorkoutRow())!
    await applyActiveWorkoutEdit('u1', old.workout.id, old.workout, { ...old.workout, name: 'Updated' })
    expect(await startWorkoutIfUnchanged(startEmpty('B', now), old.workout.id, 'u1', old.revision ?? 0)).toBe(false)
    expect((await getActiveWorkoutRow())?.workout.name).toBe('Updated')
  })
})
