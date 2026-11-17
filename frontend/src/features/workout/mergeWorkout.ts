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

const keyOf = (row: unknown) => (row as { key: string }).key

/**
 * Order is an edit too (e.g. moving an exercise). The rows above are placed in `latest`'s
 * order; if only the local side reordered the rows all three versions share, apply that order
 * to them, leaving rows added or removed on either side where they are. Two different
 * reorders cannot both win, so they are a conflict.
 */
function mergeOrder(base: unknown[], edited: unknown[], latest: unknown[], merged: unknown[]): unknown[] {
  const inEdited = new Set(edited.map(keyOf))
  const inLatest = new Set(latest.map(keyOf))
  const shared = new Set(base.map(keyOf).filter((k) => inEdited.has(k) && inLatest.has(k)))
  const order = (list: unknown[]) => list.map(keyOf).filter((k) => shared.has(k))
  const baseOrder = order(base)
  const localOrder = order(edited)
  if (equal(localOrder, baseOrder)) return merged
  if (!equal(order(latest), baseOrder) && !equal(order(latest), localOrder)) throw new ConcurrentWorkoutEditError()
  const byKey = new Map(merged.map((row) => [keyOf(row), row]))
  const next = localOrder[Symbol.iterator]()
  return merged.map((row) => (shared.has(keyOf(row)) ? byKey.get(next.next().value as string) : row))
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
    return mergeOrder(base, edited, latest, merged)
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
