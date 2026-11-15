import 'fake-indexeddb/auto'

import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
