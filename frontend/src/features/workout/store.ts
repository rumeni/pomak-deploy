import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getCurrentUserId } from '../../lib/currentUser'
import { db, type ActiveWorkoutRow } from '../../lib/db'
import type { ActiveWorkout } from './model'
import { ConcurrentWorkoutEditError, mergeWorkoutEdit } from './mergeWorkout'

/** The active workout is private to the currently signed-in account. */
async function loadOwnRow(): Promise<ActiveWorkoutRow | null> {
  const ownerId = getCurrentUserId()
  if (!ownerId) return null
  const row = await db.activeWorkout.get(ownerId)
  return row?.ownerId === ownerId ? row : null
}

export function useActiveWorkoutRow(): ActiveWorkoutRow | null | undefined {
  return useLiveQuery(loadOwnRow)
}

export async function getActiveWorkoutRow(): Promise<ActiveWorkoutRow | null> {
  return loadOwnRow()
}

export async function saveActiveWorkout(workout: ActiveWorkout): Promise<void> {
  const ownerId = getCurrentUserId()
  if (!ownerId) throw new Error('Nema prijavljenog korisnika')
  await db.activeWorkout.put({ slot: ownerId, ownerId, workout, revision: 0 })
}

/** Start or replace ONLY the workout observed before loading previous sets. */
export async function startWorkoutIfUnchanged(
  workout: ActiveWorkout, expectedId: string | null, ownerId: string, expectedRevision?: number,
): Promise<boolean> {
  if (getCurrentUserId() !== ownerId) return false
  return db.transaction('rw', db.activeWorkout, async () => {
    const current = await db.activeWorkout.get(ownerId)
    if (getCurrentUserId() !== ownerId ||
      (current?.ownerId === ownerId ? current.workout.id : null) !== expectedId ||
      (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision)) return false
    await db.activeWorkout.put({ slot: ownerId, ownerId, workout, revision: 0 })
    return true
  })
}

export class StaleWorkoutError extends Error {
  constructor() {
    super('STALE_WORKOUT')
    this.name = 'StaleWorkoutError'
  }
}

/** Discard ONLY the workout shown to the user; reject updates from other tabs. */
export async function clearActiveWorkout(ownerId: string, workoutId: string, expectedRevision?: number): Promise<void> {
  if (getCurrentUserId() !== ownerId) throw new StaleWorkoutError()
  await db.transaction('rw', db.activeWorkout, async () => {
    const active = await db.activeWorkout.get(ownerId)
    if (getCurrentUserId() !== ownerId ||
        active?.ownerId !== ownerId || active.workout.id !== workoutId ||
        (expectedRevision !== undefined && (active.revision ?? 0) !== expectedRevision)) {
      throw new StaleWorkoutError()
    }
    await db.activeWorkout.delete(ownerId)
  })
}

/** Legacy autosave caller: accept only the revision it actually read. */
export async function persistActiveWorkoutIfCurrent(row: ActiveWorkoutRow): Promise<boolean> {
  if (getCurrentUserId() !== row.ownerId || row.slot !== row.ownerId) return false
  return db.transaction('rw', db.activeWorkout, async () => {
    const current = await db.activeWorkout.get(row.slot)
    if (getCurrentUserId() !== row.ownerId ||
        current?.ownerId !== row.ownerId || current.workout.id !== row.workout.id ||
        (current.revision ?? 0) !== (row.revision ?? 0)) return false
    await db.activeWorkout.update(row.slot, { workout: row.workout, revision: (current.revision ?? 0) + 1 })
    return true
  })
}

/** Read/merge/write in one IndexedDB transaction across all browser tabs. */
export async function applyActiveWorkoutEdit(
  ownerId: string, workoutId: string, base: ActiveWorkout, edited: ActiveWorkout,
): Promise<ActiveWorkoutRow> {
  if (getCurrentUserId() !== ownerId) throw new StaleWorkoutError()
  return db.transaction('rw', db.activeWorkout, async () => {
    const row = await db.activeWorkout.get(ownerId)
    if (getCurrentUserId() !== ownerId || row?.ownerId !== ownerId || row.workout.id !== workoutId) {
      throw new StaleWorkoutError()
    }
    const workout = mergeWorkoutEdit(base, edited, row.workout)
    // Two tabs may each pass a local capacity check and together exceed it.
    // Validate inside the same transaction before writing the merged result.
    if (workout.exercises.length > 40 || workout.exercises.some((item) => item.sets.length > 20)) {
      throw new ConcurrentWorkoutEditError()
    }
    const saved: ActiveWorkoutRow = { ...row, workout, revision: (row.revision ?? 0) + 1 }
    await db.activeWorkout.put(saved)
    return saved
  })
}

/**
 * UI edits are optimistic for fast typing. The durable queue replays each
 * individual edit over fresh IndexedDB state, preserving other tabs' changes.
 * Exact same-field conflicts are surfaced instead of silently overwritten.
 */
export function shouldApplyWorkoutRefresh(pendingCount: number, conflict: boolean): boolean {
  return pendingCount === 0 && !conflict
}

export function matchesDisplayedWorkout(viewedId: string | null, row: ActiveWorkoutRow | null): boolean {
  return viewedId === null || row?.workout.id === viewedId
}

export function usePersistentWorkout() {
  type State = { loaded: boolean; row: ActiveWorkoutRow | null }
  const [state, setState] = useState<State>({ loaded: false, row: null })
  const live = useLiveQuery(loadOwnRow)
  const latestState = useRef<State>({ loaded: false, row: null })
  const pending = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const hasConflict = useRef(false)
  const displayedWorkoutId = useRef<string | null>(null)
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    if (live === undefined || pending.current || hasConflict.current) return
    if (!matchesDisplayedWorkout(displayedWorkoutId.current, live)) {
      hasConflict.current = true
      setConflict(true)
      return
    }
    if (live) displayedWorkoutId.current = live.workout.id
    const next = { loaded: true, row: live }
    latestState.current = next
    setState(next)
  }, [live])

  const update = useCallback((change: (workout: ActiveWorkout) => ActiveWorkout) => {
    const original = latestState.current.row
    if (!original || hasConflict.current || getCurrentUserId() !== original.ownerId) return
    // Run the callback ONCE: newly generated set UUIDs must stay identical.
    const edited = change(original.workout)
    const optimistic = { ...original, workout: edited }
    latestState.current = { loaded: true, row: optimistic }
    setState(latestState.current)
    pending.current += 1
    const job = async () => {
      try {
        if (hasConflict.current) return
        await applyActiveWorkoutEdit(original.ownerId, original.workout.id, original.workout, edited)
      } catch {
        // Conflict or storage failure: stop writing and show a recovery action.
        hasConflict.current = true
        setConflict(true)
      } finally {
        pending.current -= 1
        if (shouldApplyWorkoutRefresh(pending.current, hasConflict.current)) {
          try {
            const fresh = await loadOwnRow()
            // Another keystroke may have arrived while awaiting the read;
            // never roll it back with the stale snapshot.
            if (shouldApplyWorkoutRefresh(pending.current, hasConflict.current) &&
                getCurrentUserId() === original.ownerId) {
              if (!matchesDisplayedWorkout(displayedWorkoutId.current, fresh)) {
                hasConflict.current = true
                setConflict(true)
              } else {
                if (fresh) displayedWorkoutId.current = fresh.workout.id
                const next = { loaded: true, row: fresh }
                latestState.current = next
                setState(next)
              }
            }
          } catch {
            hasConflict.current = true
            setConflict(true)
          }
        }
      }
    }
    queue.current = queue.current.then(job, job)
  }, [])

  const flush = useCallback(async (): Promise<ActiveWorkoutRow | null> => {
    await queue.current
    if (hasConflict.current) throw new ConcurrentWorkoutEditError()
    return loadOwnRow()
  }, [])

  return { loaded: state.loaded, row: state.row, update, flush, conflict }
}
