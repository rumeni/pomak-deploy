import type { ActiveWorkout } from './model'

export class ConcurrentWorkoutEditError extends Error {
  constructor() {
    super('CONCURRENT_WORKOUT_EDIT')
    this.name = 'ConcurrentWorkoutEditError'
  }
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
function keyed(a: unknown[]): boolean {
  return a.every((v) => record(v) && typeof v.key === 'string')
}

/** Merge local edits over the latest saved row, never over a stale whole-object snapshot. */
export function mergeWorkoutValue(base: unknown, edited: unknown, latest: unknown): unknown {
  if (equal(base, edited)) return latest
  if (equal(base, latest)) return edited
  if (equal(edited, latest)) return latest
  if (Array.isArray(base) && Array.isArray(edited) && Array.isArray(latest) &&
      keyed(base) && keyed(edited) && keyed(latest)) {
    const original = new Map(base.map((x) => [(x as { key: string }).key, x]))
    const changes = new Map(edited.map((x) => [(x as { key: string }).key, x]))
    const saved = new Map(latest.map((x) => [(x as { key: string }).key, x]))
    const merged: unknown[] = []
    for (const row of latest) {
      const key = (row as { key: string }).key
      if (!original.has(key)) {
        if (changes.has(key) && !equal(changes.get(key), row)) throw new ConcurrentWorkoutEditError()
        merged.push(row)
      } else if (!changes.has(key)) {
        if (!equal(original.get(key), row)) throw new ConcurrentWorkoutEditError()
      } else {
        merged.push(mergeWorkoutValue(original.get(key), changes.get(key), row))
      }
    }
    for (const row of edited) {
      const key = (row as { key: string }).key
      if (!original.has(key) && !saved.has(key)) merged.push(row)
      else if (original.has(key) && !saved.has(key) &&
        !equal(original.get(key), row)) throw new ConcurrentWorkoutEditError()
    }
    return merged
  }
  if (record(base) && record(edited) && record(latest)) {
    const result = { ...latest }
    for (const key of new Set([...Object.keys(base), ...Object.keys(edited)])) {
      if (!(key in edited)) {
        if (!equal(base[key], latest[key])) throw new ConcurrentWorkoutEditError()
        delete result[key]
      } else {
        result[key] = mergeWorkoutValue(base[key], edited[key], latest[key])
      }
    }
    return result
  }
  throw new ConcurrentWorkoutEditError()
}

export function mergeWorkoutEdit(base: ActiveWorkout, edited: ActiveWorkout, latest: ActiveWorkout): ActiveWorkout {
  if (base.id !== edited.id || latest.id !== base.id) throw new ConcurrentWorkoutEditError()
  return mergeWorkoutValue(base, edited, latest) as ActiveWorkout
}
