import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { setCurrentUserId } from '../../lib/currentUser'
import { db } from '../../lib/db'
import type { ActiveWorkout } from './model'
import { clearActiveWorkout, getActiveWorkoutRow, saveActiveWorkout } from './store'

beforeEach(async () => {
  await db.activeWorkout.clear()
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
