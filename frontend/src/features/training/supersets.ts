/**
 * Supersets and tri-sets: exercises next to each other with the same `superset` number are done
 * back to back (A1 -> A2 -> rest). The same rules as the backend (training/serializers.py):
 * members are next to each other, at most MAX_SUPERSET_SIZE of them, numbered 1, 2 ... in order,
 * and a number left on a single exercise means nothing.
 */
export const MAX_SUPERSET_SIZE = 3

export interface Grouped {
  superset?: number | null
}

/** First and last index of the block an exercise belongs to (itself when it is on its own). */
export function blockOf(items: Grouped[], index: number): [number, number] {
  const number = items[index]?.superset ?? null
  if (number === null) return [index, index]
  let start = index
  let end = index
  while (start > 0 && items[start - 1].superset === number) start -= 1
  while (end < items.length - 1 && items[end + 1].superset === number) end += 1
  return [start, end]
}

/** The list split into blocks: single exercises and supersets, in order. */
export function blocks<T extends Grouped>(items: T[]): { start: number; items: T[] }[] {
  const result: { start: number; items: T[] }[] = []
  let index = 0
  while (index < items.length) {
    const [start, end] = blockOf(items, index)
    result.push({ start, items: items.slice(start, end + 1) })
    index = end + 1
  }
  return result
}

/** Numbers supersets 1, 2 ... in order and clears a number left on a single exercise. */
export function renumber<T extends Grouped>(items: T[]): T[] {
  let count = 0
  return blocks(items).flatMap((block) => {
    const together = block.items.length > 1
    if (together) count += 1
    return block.items.map((item) => {
      const superset = together ? count : null
      return (item.superset ?? null) === superset ? item : { ...item, superset }
    })
  })
}

/** "A1", "A2", "B1" ... for exercises in a superset, null for one on its own. */
export function supersetLabels(items: Grouped[]): (string | null)[] {
  const labels: (string | null)[] = []
  let letter = 0
  for (const block of blocks(items)) {
    if (block.items.length > 1) {
      const name = String.fromCharCode(65 + (letter++ % 26))
      block.items.forEach((_, i) => labels.push(`${name}${i + 1}`))
    } else {
      labels.push(null)
    }
  }
  return labels
}

export function linkedWithNext(items: Grouped[], index: number): boolean {
  const number = items[index]?.superset ?? null
  return number !== null && items[index + 1]?.superset === number
}

/** Whether the exercise and the next one can be joined without making a block too big. */
export function canLink(items: Grouped[], index: number): boolean {
  if (index < 0 || index >= items.length - 1 || linkedWithNext(items, index)) return false
  const [start] = blockOf(items, index)
  const [, end] = blockOf(items, index + 1)
  return end - start + 1 <= MAX_SUPERSET_SIZE
}

/**
 * Joins an exercise with the next one (their blocks become one superset), or splits a superset
 * between them. Returns the list unchanged when the join would make a block too big.
 */
export function toggleLink<T extends Grouped>(items: T[], index: number): T[] {
  if (index < 0 || index >= items.length - 1) return items
  const fresh = Math.max(0, ...items.map((item) => item.superset ?? 0)) + 1
  if (linkedWithNext(items, index)) {
    const [, end] = blockOf(items, index)
    return renumber(items.map((item, i) => (i > index && i <= end ? { ...item, superset: fresh } : item)))
  }
  if (!canLink(items, index)) return items
  const [start] = blockOf(items, index)
  const [, end] = blockOf(items, index + 1)
  return renumber(items.map((item, i) => (i >= start && i <= end ? { ...item, superset: fresh } : item)))
}

/**
 * Moves an exercise one place up (-1) or down (+1). Inside a superset it swaps with its partner;
 * otherwise it leaves its superset and jumps over the whole neighbouring block, so a superset is
 * never split by an exercise landing in the middle of it.
 */
export function moveItem<T extends Grouped>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items
  const item = items[index]
  if ((item.superset ?? null) !== null && items[target].superset === item.superset) {
    const list = [...items]
    ;[list[index], list[target]] = [list[target], list[index]]
    return list
  }
  const [start, end] = blockOf(items, target)
  const rest = items.filter((_, i) => i !== index)
  const moved = { ...item, superset: null }
  // In `rest` everything after `index` moved one place up: up lands before the block, down after it.
  rest.splice(delta < 0 ? start : end, 0, moved)
  return renumber(rest)
}

/** Removes an exercise; a superset left with one exercise becomes a single exercise again. */
export function removeItem<T extends Grouped>(items: T[], index: number): T[] {
  return renumber(items.filter((_, i) => i !== index))
}
