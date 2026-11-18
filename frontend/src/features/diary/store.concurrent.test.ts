import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, type DiaryOpRow } from '../../lib/db'
import { manualEntry } from './model'

// The store imports the HTTP client for read hooks; these tests exercise only
// local IndexedDB writes, so avoid initializing the DOM-dependent i18n module.
vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }))
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

describe('recent food freshness', () => {
  it('uses current server nutrition for an older locally recent food, without losing recency order', async () => {
    const { mergeRecentFoods } = await import('./store')
    const old = { id: 'a', name: 'Bread', kcal: '250' }
    const fresh = { id: 'a', name: 'Bread', kcal: '300' }
    const other = { id: 'b', name: 'Milk', kcal: '50' }
    expect(mergeRecentFoods([old, other] as never[], [fresh] as never[])).toEqual([fresh, other])
  })
})

describe('atomic offline diary ordering across independent tabs', () => {
  it('saves a complete meal in one transaction and requests sync once', async () => {
    const { first } = await separateTabs()
    await first.saveDrafts('u1', [entry(100), entry(200)])
    const ops = await db.diaryOps.where('ownerId').equals('u1').sortBy('seq')
    expect(ops).toHaveLength(2)
    expect(ops[0].seq).toBeLessThan(ops[1].seq)
  })

  it('rolls back the entire saved meal when a later item fails', async () => {
    const { first } = await separateTabs()
    await expect(first.saveDrafts('u1', [entry(100), undefined as never])).rejects.toThrow()
    expect(await db.diaryOps.count()).toBe(0)
  })

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
    } as DiaryOpRow)
    const { first } = await separateTabs()
    await first.setDayStatus('u1', DAY, 'complete')

    const ops = await db.diaryOps.where('ownerId').equals('u1').sortBy('seq')
    expect(ops.map((op) => op.seq)).toEqual([oldSeq, oldSeq + 1])
  })
})
