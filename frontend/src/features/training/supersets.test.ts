import { describe, expect, it } from 'vitest'

import { blocks, canLink, moveItem, removeItem, renumber, supersetLabels, toggleLink } from './supersets'

type Item = { name: string; superset?: number | null }
const list = (...groups: (number | null)[]): Item[] => groups.map((superset, i) => ({ name: String.fromCharCode(97 + i), superset }))
const shape = (items: Item[]) => items.map((i) => `${i.name}${i.superset ?? ''}`).join(' ')

describe('supersets', () => {
  it('labels supersets A1, A2, B1 ... and leaves single exercises unlabelled', () => {
    expect(supersetLabels(list(null, 1, 1, null, 2, 2, 2))).toEqual([null, 'A1', 'A2', null, 'B1', 'B2', 'B3'])
    // Older routines have no field at all.
    const older: Item[] = [{ name: 'x' }, { name: 'y' }]
    expect(supersetLabels(older)).toEqual([null, null])
  })

  it('renumbers in order and clears a number left on one exercise', () => {
    expect(shape(renumber(list(7, 7, 3, null, 5, 5)))).toBe('a1 b1 c d e2 f2')
    expect(blocks(list(1, 1, null)).map((b) => b.items.length)).toEqual([2, 1])
  })

  it('joins two exercises, adds a third, and refuses a fourth', () => {
    let items = toggleLink(list(null, null, null, null), 0)
    expect(shape(items)).toBe('a1 b1 c d')
    items = toggleLink(items, 1)
    expect(shape(items)).toBe('a1 b1 c1 d')
    expect(canLink(items, 2)).toBe(false)
    expect(toggleLink(items, 2)).toBe(items)
  })

  it('joins a single exercise with a following superset', () => {
    expect(shape(toggleLink(list(null, 1, 1), 0))).toBe('a1 b1 c1')
  })

  it('splitting a tri-set keeps the pair that is still together', () => {
    expect(shape(toggleLink(list(1, 1, 1), 0))).toBe('a b1 c1')
    expect(shape(toggleLink(list(1, 1, 1), 1))).toBe('a1 b1 c')
    expect(shape(toggleLink(list(1, 1), 0))).toBe('a b')
  })

  it('moving inside a superset swaps the partners', () => {
    expect(shape(moveItem(list(1, 1, null), 1, -1))).toBe('b1 a1 c')
  })

  it('moving a single exercise jumps over a whole superset instead of splitting it', () => {
    expect(shape(moveItem(list(1, 1, null), 2, -1))).toBe('c a1 b1')
    expect(shape(moveItem(list(null, 1, 1), 0, 1))).toBe('b1 c1 a')
  })

  it('moving the first or last exercise of a superset out of it takes it out', () => {
    expect(shape(moveItem(list(null, 1, 1, 1), 1, -1))).toBe('b a c1 d1')
    expect(shape(moveItem(list(1, 1, null), 1, 1))).toBe('a c b')
  })

  it('out-of-range moves change nothing', () => {
    const items = list(1, 1)
    expect(moveItem(items, 0, -1)).toBe(items)
    expect(moveItem(items, 1, 1)).toBe(items)
  })

  it('removing an exercise leaves a superset of one as a single exercise', () => {
    expect(shape(removeItem(list(1, 1, 2, 2, 2), 0))).toBe('b c1 d1 e1')
  })
})
