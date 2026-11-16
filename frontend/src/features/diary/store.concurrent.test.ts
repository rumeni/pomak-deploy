import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../lib/db'
import { manualEntry } from './model'

vi.mock('../workout/sync', () => ({ requestSync: vi.fn() }))

const DAY = '2026-11-16'
const FIXED_TIME = 1_794_856_800_000

/** Each import has independent module state, like a separately loaded browser tab. */
async function separateTabs() {
  vi.resetModules()
  const first = await import('./store')
  vi.resetModules()
  const second = await import('./store')
  return { first, second }
}

const entry = (kcal: number) => manualEntry(
  'same-entry', DAY, 'lunch', 'Offline meal',
  { kcal: String(kcal), protein_g: null, carbs_g: null, fat_g: null, fiber_g: null },
  new Date('2026-11-16T12:00:00Z'),
)

beforeEach(async () => {
  await db.diaryOps.clear()
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_TIME)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('atomic offline diary ordering across independent tabs', () => {
  it('orders successive edits from different tabs in the same millisecond', async () => {
    const { first, second } = await separateTabs()
    await first.saveEntry('u1', 'same-entry', entry(150))
    await second.saveEntry('u1', 'same-entry', entry(200))

    const ops = await db.diaryOps.where('ownerId').equals('u1').sortBy('seq')
    expect(ops).toHaveLength(2)
    expect(ops[0].type).toBe('upsert')
    expect(ops[1].type).toBe('upsert')
    expect(ops[0].seq).toBeLessThan(ops[1].seq)
    if (ops[0].type !== 'upsert' || ops[1].type !== 'upsert') throw new Error('Expected upserts')
    expect(ops.map((op) => op.type === 'upsert' ? op.body.kcal : null)).toEqual(['150.0', '200.0'])
  })

  it('allocates unique sequences for simultaneous writes across tabs and accounts', async () => {
    const { first, second } = await separateTabs()
    await Promise.all([
      first.setDayStatus('u1', DAY, 'in_progress'),
      second.setDayStatus('u1', DAY, 'complete'),
      first.setDayStatus('u2', DAY, 'incomplete'),
      second.setDayStatus('u2', DAY, 'complete'),
    ])

    const ops = await db.diaryOps.toArray()
    expect(ops).toHaveLength(4)
    expect(new Set(ops.map((op) => op.seq)).size).toBe(4)
    expect(ops.every((op) => op.seq >= FIXED_TIME * 1000)).toBe(true)
  })

  it('puts a delete after an upsert from another tab in the same millisecond', async () => {
    const { first, second } = await separateTabs()
    await first.saveEntry('u1', 'same-entry', entry(150))
    await second.deleteEntry('u1', DAY, 'same-entry')

    const ops = await db.diaryOps.where('ownerId').equals('u1').sortBy('seq')
    expect(ops.map((op) => op.type)).toEqual(['upsert', 'delete'])
    expect(ops[0].seq).toBeLessThan(ops[1].seq)
  })

  it('continues after a pre-existing high sequence from an older client', async () => {
    const oldSeq = FIXED_TIME * 1000 + 100
    await db.diaryOps.put({
      id: 'legacy', ownerId: 'u1', date: DAY, seq: oldSeq,
      error: null, type: 'status', status: 'in_progress',
    })
    const { first } = await separateTabs()
    await first.setDayStatus('u1', DAY, 'complete')

    const ops = await db.diaryOps.where('ownerId').equals('u1').sortBy('seq')
    expect(ops.map((op) => op.seq)).toEqual([oldSeq, oldSeq + 1])
  })
})
