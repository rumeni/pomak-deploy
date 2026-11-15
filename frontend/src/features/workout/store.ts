import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getCurrentUserId } from '../../lib/currentUser'
import { db, type ActiveWorkoutRow } from '../../lib/db'
import type { ActiveWorkout } from './model'

/** Aktivan trening prijavljenog korisnika; trening drugog naloga na istom telefonu se ne vidi. */
async function loadOwnRow(): Promise<ActiveWorkoutRow | null> {
  const row = await db.activeWorkout.get('current')
  return row && row.ownerId === getCurrentUserId() ? row : null
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
  await db.activeWorkout.put({ slot: 'current', ownerId, workout })
}

export async function clearActiveWorkout(): Promise<void> {
  await db.activeWorkout.delete('current')
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
    if (changed.current && state.row) void db.activeWorkout.put(state.row)
  }, [state.row])

  const update = useCallback((change: (w: ActiveWorkout) => ActiveWorkout) => {
    changed.current = true
    setState((s) => (s.row ? { ...s, row: { ...s.row, workout: change(s.row.workout) } } : s))
  }, [])

  return { loaded: state.loaded, row: state.row, update }
}
