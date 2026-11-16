import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getCurrentUserId } from '../../lib/currentUser'
import { db, type ActiveWorkoutRow } from '../../lib/db'
import type { ActiveWorkout } from './model'

/** Aktivan trening prijavljenog korisnika; trening drugog naloga na istom telefonu se ne vidi. */
async function loadOwnRow(): Promise<ActiveWorkoutRow | null> {
  const ownerId = getCurrentUserId()
  if (!ownerId) return null
  const row = await db.activeWorkout.get(ownerId)
  return row?.ownerId === ownerId ? row : null
}

/** Za trake "Trening u toku": `undefined` dok se učitava, `null` ako ga nema. */
export function useActiveWorkoutRow(): ActiveWorkoutRow | null | undefined {
  return useLiveQuery(loadOwnRow)
}

export async function getActiveWorkoutRow(): Promise<ActiveWorkoutRow | null> {
  return loadOwnRow()
}

export async function saveActiveWorkout(workout: ActiveWorkout): Promise<void> {
  const ownerId = getCurrentUserId()
  if (!ownerId) throw new Error('Nema prijavljenog korisnika')
  await db.activeWorkout.put({ slot: ownerId, ownerId, workout })
}

/**
 * Compare-and-swap for starting/replacing a workout. The original workout ID
 * observed by the caller must still be active when previous-set data finishes
 * loading. An account switch or another tab starting a workout aborts instead
 * of destroying already-entered sets.
 */
export async function startWorkoutIfUnchanged(
  workout: ActiveWorkout, expectedId: string | null, ownerId: string,
): Promise<boolean> {
  if (getCurrentUserId() !== ownerId) return false
  return db.transaction('rw', db.activeWorkout, async () => {
    const current = await db.activeWorkout.get(ownerId)
    if (getCurrentUserId() !== ownerId ||
      (current?.ownerId === ownerId ? current.workout.id : null) !== expectedId) return false
    await db.activeWorkout.put({ slot: ownerId, ownerId, workout })
    return true
  })
}

/** A tab may still display workout A after another tab replaces it with B. */
export class StaleWorkoutError extends Error {
  constructor() {
    super('STALE_WORKOUT')
    this.name = 'StaleWorkoutError'
  }
}

/** Discard ONLY the workout this screen is showing, never a replacement. */
export async function clearActiveWorkout(ownerId: string, workoutId: string): Promise<void> {
  if (getCurrentUserId() !== ownerId) throw new StaleWorkoutError()
  await db.transaction('rw', db.activeWorkout, async () => {
    const active = await db.activeWorkout.get(ownerId)
    if (getCurrentUserId() !== ownerId ||
        active?.ownerId !== ownerId || active.workout.id !== workoutId) {
      throw new StaleWorkoutError()
    }
    await db.activeWorkout.delete(ownerId)
  })
}

/**
 * Autosave must NEVER create a row. A finished/discarded workout has been
 * removed from IndexedDB and a late React effect or previous-result fetch
 * cannot reinsert it. A different workout started for the same owner must
 * not be overwritten by an old in-flight write.
 *
 * The identity check and update run in the same read-write transaction, so
 * finishWorkout's outbox+delete transaction cannot interleave between them.
 */
export async function persistActiveWorkoutIfCurrent(row: ActiveWorkoutRow): Promise<boolean> {
  if (getCurrentUserId() !== row.ownerId || row.slot !== row.ownerId) return false
  return db.transaction('rw', db.activeWorkout, async () => {
    const current = await db.activeWorkout.get(row.slot)
    if (getCurrentUserId() !== row.ownerId ||
        current?.ownerId !== row.ownerId || current.workout.id !== row.workout.id) return false
    await db.activeWorkout.update(row.slot, { workout: row.workout })
    return true
  })
}

/**
 * Trening za ekran tokom vežbanja: stanje je u memoriji (brz unos bez gubljenja znakova),
 * a svaka izmena se odmah prepisuje u lokalnu bazu.
 */
export function usePersistentWorkout() {
  const [state, setState] = useState<{ loaded: boolean; row: ActiveWorkoutRow | null }>({ loaded: false, row: null })
  const changed = useRef(false)

  useEffect(() => {
    let alive = true
    void loadOwnRow().then((row) => alive && setState({ loaded: true, row }))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (changed.current && state.row) void persistActiveWorkoutIfCurrent(state.row)
  }, [state.row])

  const update = useCallback((change: (w: ActiveWorkout) => ActiveWorkout) => {
    changed.current = true
    setState((s) => (s.row ? { ...s, row: { ...s.row, workout: change(s.row.workout) } } : s))
  }, [])

  return { loaded: state.loaded, row: state.row, update }
}
