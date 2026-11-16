import 'fake-indexeddb/auto'

import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, type DiaryOpRow } from '../../lib/db'
import { diaryRequest, syncDiary } from './sync'

const row = (seq: number, rest: Partial<DiaryOpRow>): DiaryOpRow =>
  ({ id: `op${seq}`, ownerId: 'u1', date: '2026-09-30', seq, error: null, type: 'delete', entryId: `e${seq}`, ...rest }) as DiaryOpRow

function httpError(status: number, data: unknown = {}): AxiosError {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', 'ERR', undefined, undefined, { status, data, statusText: '', headers, config: { headers } })
}

beforeEach(async () => {
  await db.diaryOps.clear()
  await db.diarySyncLeases.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('syncDiary', () => {
  it('šalje redom i briše poslate; vraća datume za osvežavanje', async () => {
    await db.diaryOps.bulkAdd([row(2, {}), row(1, { date: '2026-09-29' })])
    const sent: string[] = []
    const changed = await syncDiary('u1', async (op) => void sent.push(op.id))
    expect(sent).toEqual(['op1', 'op2'])
    expect([...changed].sort()).toEqual(['2026-09-29', '2026-09-30'])
    expect(await db.diaryOps.count()).toBe(0)
  })

  it('bez interneta staje i ništa ne gubi; tuđe izmene ne šalje', async () => {
    await db.diaryOps.bulkAdd([row(1, {}), row(2, {}), row(3, { ownerId: 'u2' })])
    const send = vi.fn().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    await syncDiary('u1', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(await db.diaryOps.count()).toBe(3)
  })

  it('stale response posle logout-a ne uklanja nesinhronizovanu stavku', async () => {
    await db.diaryOps.add(row(1, {}))
    let active = true
    let finish!: () => void
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => { started = resolve })
    const task = syncDiary('u1', async () => {
      started()
      await new Promise<void>((resolve) => { finish = resolve })
    }, () => active, 'old-session')
    await startedPromise
    active = false
    finish()
    await task
    expect(await db.diaryOps.get('op1')).toBeDefined()
  })

  it('odbijena izmena dobija poruku, a sledeće idu dalje', async () => {
    await db.diaryOps.bulkAdd([row(1, {}), row(2, {})])
    const send = vi.fn(async (op: DiaryOpRow) => {
      if (op.id === 'op1') throw httpError(400, { grams: ['Unesi količinu u gramima.'] })
    })
    await syncDiary('u1', send)
    expect((await db.diaryOps.get('op1'))?.error).toBe('Unesi količinu u gramima.')
    expect(await db.diaryOps.get('op2')).toBeUndefined()
  })
})

describe('diaryRequest', () => {
  it('svaka izmena ima svoj idempotentni zahtev', () => {
    expect(diaryRequest(row(1, { type: 'delete', entryId: 'e1' }))).toEqual({ method: 'delete', url: '/nutrition/entries/e1/' })
    expect(diaryRequest(row(1, { type: 'status', status: 'complete' } as Partial<DiaryOpRow>))).toEqual({
      method: 'put',
      url: '/nutrition/days/2026-09-30/',
      body: { status: 'complete' },
    })
  })
})


/** Independent tab sessions share IndexedDB, but not their in-memory `running` map. */
function mockWebLocks() {
  const last = new Map<string, Promise<void>>()
  return {
    request: vi.fn(async <T>(name: string, run: () => Promise<T>): Promise<T> => {
      const previous = last.get(name) ?? Promise.resolve()
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      last.set(name, previous.then(() => held))
      await previous
      try {
        return await run()
      } finally {
        release()
      }
    }),
  }
}

function diaryAmount(seq: number, grams: number, ownerId = 'u1'): DiaryOpRow {
  return row(seq, {
    ownerId, type: 'upsert', entryId: 'same-food-entry',
    body: { grams: String(grams) } as never,
    preview: { date: '2026-09-30' } as never,
  } as Partial<DiaryOpRow>)
}

describe('cross-tab diary sync ordering regression (#53)', () => {
  it('two tabs cannot let a late 150 g request overwrite newer 200 g', async () => {
    const locks = mockWebLocks()
    vi.stubGlobal('navigator', { locks })
    await db.diaryOps.bulkAdd([diaryAmount(1, 150), diaryAmount(2, 200)])

    let firstStarted!: () => void
    let resumeFirst!: () => void
    const started = new Promise<void>((resolve) => { firstStarted = resolve })
    const pause = new Promise<void>((resolve) => { resumeFirst = resolve })
    let serverGrams = '100'
    const writes: string[] = []
    const first = syncDiary('u1', async (op) => {
      if (op.id === 'op1') { firstStarted(); await pause }
      serverGrams = (op as Extract<DiaryOpRow, { type: 'upsert' }>).body.grams!
      writes.push(`first:${op.id}`)
    }, () => true, 'first-tab')

    await started
    const secondSend = vi.fn(async (op: DiaryOpRow) => {
      serverGrams = (op as Extract<DiaryOpRow, { type: 'upsert' }>).body.grams!
      writes.push(`second:${op.id}`)
    })
    const second = syncDiary('u1', secondSend, () => true, 'second-tab')
    await Promise.resolve()
    expect(secondSend).not.toHaveBeenCalled()
    expect(serverGrams).toBe('100')

    resumeFirst()
    await Promise.all([first, second])
    expect(writes).toEqual(['first:op1', 'first:op2'])
    expect(serverGrams).toBe('200')
    expect(await db.diaryOps.count()).toBe(0)
    expect(locks.request).toHaveBeenCalledTimes(2)
  })

  it('rechecks the account/session after waiting for another tab to finish', async () => {
    vi.stubGlobal('navigator', { locks: mockWebLocks() })
    await db.diaryOps.add(diaryAmount(1, 150))
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => { started = resolve })
    const pause = new Promise<void>((resolve) => { release = resolve })
    const first = syncDiary('u1', async () => { started(); await pause }, () => true, 'old-tab')
    await startedPromise

    // A later edit was created after the first tab read the initial batch.
    await db.diaryOps.add(diaryAmount(2, 200))
    let current = true
    const sendNew = vi.fn(async () => undefined)
    const next = syncDiary('u1', sendNew, () => current, 'logged-out-tab')
    current = false
    release()
    await Promise.all([first, next])
    expect(sendNew).not.toHaveBeenCalled()
    expect((await db.diaryOps.get('op2'))?.id).toBe('op2')
  })

  it('different user accounts can synchronize without blocking each other', async () => {
    vi.stubGlobal('navigator', { locks: mockWebLocks() })
    await db.diaryOps.bulkAdd([diaryAmount(1, 150, 'u1'), diaryAmount(2, 250, 'u2')])
    let started!: () => void
    let release!: () => void
    const startPromise = new Promise<void>((resolve) => { started = resolve })
    const pause = new Promise<void>((resolve) => { release = resolve })
    const slow = syncDiary('u1', async () => { started(); await pause }, () => true, 'tab-u1')
    await startPromise
    const otherSend = vi.fn()
    await syncDiary('u2', otherSend, () => true, 'tab-u2')
    expect(otherSend).toHaveBeenCalledTimes(1)
    expect((await db.diaryOps.get('op1'))?.ownerId).toBe('u1')
    expect(await db.diaryOps.get('op2')).toBeUndefined()
    release()
    await slow
  })

  it('uses an atomic IndexedDB lease when Web Locks are absent and retries later', async () => {
    vi.stubGlobal('navigator', { locks: undefined })
    await db.diaryOps.bulkAdd([diaryAmount(1, 150), diaryAmount(2, 200)])
    let started!: () => void
    let release!: () => void
    const startPromise = new Promise<void>((resolve) => { started = resolve })
    const pause = new Promise<void>((resolve) => { release = resolve })
    const first = syncDiary('u1', async (op) => {
      if (op.id === 'op1') { started(); await pause }
    }, () => true, 'fallback-tab-a')
    await startPromise

    const secondSend = vi.fn()
    expect((await syncDiary('u1', secondSend, () => true, 'fallback-tab-b')).size).toBe(0)
    expect(secondSend).not.toHaveBeenCalled()
    expect(await db.diarySyncLeases.count()).toBe(1)
    release()
    await first
    expect(await db.diarySyncLeases.count()).toBe(0)

    await db.diaryOps.add(diaryAmount(3, 300))
    await syncDiary('u1', secondSend, () => true, 'fallback-retry')
    expect(secondSend).toHaveBeenCalledTimes(1)
    expect(await db.diaryOps.count()).toBe(0)
  })



  it('refuses to resume an expired fallback lease even before heartbeat fires', async () => {
    vi.stubGlobal('navigator', { locks: undefined })
    await db.diaryOps.bulkAdd([diaryAmount(1, 150), diaryAmount(2, 200)])
    let started!: () => void
    let release!: () => void
    const begun = new Promise<void>((resolve) => { started = resolve })
    const pause = new Promise<void>((resolve) => { release = resolve })
    const staleSend = vi.fn(async (op: DiaryOpRow) => {
      if (op.id === 'op1') { started(); await pause }
    })
    const old = syncDiary('u1', staleSend, () => true, 'suspended-old-tab')
    await begun
    // Simulate a 2+ minute background suspension and takeover while timers
    // haven't run in the old tab. Another tab acquires the expired lease.
    const leaseKey = 'pomak:diary-sync:u1'
    await db.diarySyncLeases.update(leaseKey, { expiresAt: Date.now() - 1 })
    const newerSend = vi.fn(async () => undefined)
    await syncDiary('u1', newerSend, () => true, 'new-owner-tab')
    expect(newerSend).toHaveBeenCalledTimes(2)
    release()
    await old
    // Old tab must not continue with stale second op or delete already
    // acknowledged entries after losing ownership.
    expect(staleSend).toHaveBeenCalledTimes(1)
    expect(await db.diaryOps.count()).toBe(0)
    expect(await db.diarySyncLeases.count()).toBe(0)
  })

  it('does not revive an expired lease when the suspended tab resumes before takeover', async () => {
    vi.stubGlobal('navigator', { locks: undefined })
    await db.diaryOps.bulkAdd([diaryAmount(1, 150), diaryAmount(2, 200)])
    let started!: () => void
    let release!: () => void
    const begun = new Promise<void>((resolve) => { started = resolve })
    const pause = new Promise<void>((resolve) => { release = resolve })
    const staleSend = vi.fn(async (op: DiaryOpRow) => {
      if (op.id === 'op1') { started(); await pause }
    })
    const old = syncDiary('u1', staleSend, () => true, 'expired-old')
    await begun
    await db.diarySyncLeases.update('pomak:diary-sync:u1', { expiresAt: Date.now() - 1 })
    release()
    await old
    expect(staleSend).toHaveBeenCalledTimes(1)
    // An older tab cannot flush the rest; another one can recover on retry.
    expect(await db.diaryOps.count()).toBe(2)
    const newerSend = vi.fn(async () => undefined)
    await syncDiary('u1', newerSend, () => true, 'fresh-retry')
    expect(newerSend).toHaveBeenCalledTimes(2)
    expect(await db.diaryOps.count()).toBe(0)
  })

  it('recovers an expired lease left by a crashed legacy tab', async () => {
    vi.stubGlobal('navigator', { locks: undefined })
    await db.diaryOps.add(diaryAmount(1, 150))
    await db.diarySyncLeases.put({
      key: 'pomak:diary-sync:u1', holder: 'crashed-tab', expiresAt: Date.now() - 1,
    })
    const send = vi.fn()
    await syncDiary('u1', send, () => true, 'recovery')
    expect(send).toHaveBeenCalledTimes(1)
    expect(await db.diaryOps.count()).toBe(0)
    expect(await db.diarySyncLeases.count()).toBe(0)
  })
})
