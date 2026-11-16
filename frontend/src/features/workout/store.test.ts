import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { setCurrentUserId } from '../../lib/currentUser'
import { db } from '../../lib/db'
import { startEmpty, type ActiveWorkout, type SessionPayload } from './model'
import { finishWorkout } from './outbox'
import { clearActiveWorkout, getActiveWorkoutRow, persistActiveWorkoutIfCurrent, saveActiveWorkout } from './store'

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
    await clearActiveWorkout()
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
    await clearActiveWorkout()
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
