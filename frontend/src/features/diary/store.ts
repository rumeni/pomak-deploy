import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import { api } from '../../lib/api'
import { db, type DiaryOpRow } from '../../lib/db'
import { uuid } from '../../lib/uuid'
import type { Food } from '../nutrition/api'
import { requestSync } from '../workout/sync'
import { applyOps, type DisplayDay, type EntryDraft } from './model'
import type { DayStatus, DiaryDay, DiaryEntry, EntryWrite } from './types'

const dayKey = (ownerId: string, date: string) => `${ownerId}:${date}`

/**
 * Assign the sequence in the SAME IndexedDB readwrite transaction as the insert.
 * Browser tabs have separate JS counters, but IndexedDB serializes overlapping
 * write transactions, so the next queued operation always follows the latest
 * committed one even if both tabs see the same millisecond or the clock moves back.
 * The existing seq index also covers rows written by older app versions.
 */
async function addQueuedOp(ownerId: string, date: string, op: NewOp): Promise<void> {
  const latest = await db.diaryOps.orderBy('seq').last()
  const seq = Math.max(Date.now() * 1000, (latest?.seq ?? 0) + 1)
  await db.diaryOps.add({ ...op, id: uuid(), ownerId, date, seq, error: null } as DiaryOpRow)
}

type NewOp =
  | { type: 'upsert'; entryId: string; body: EntryWrite; preview: DiaryEntry }
  | { type: 'delete'; entryId: string }
  | { type: 'status'; status: DayStatus }

async function enqueue(ownerId: string, date: string, op: NewOp): Promise<void> {
  await db.transaction('rw', db.diaryOps, () => addQueuedOp(ownerId, date, op))
  requestSync()
}

/**
 * Upisuje ili menja stavku. Izmena se beleži pod datumom na kome je stavka BILA (`date` op-a),
 * a novi datum je u `preview`; prikaz dana gleda oba, pa premeštena stavka odmah prelazi.
 */
export function saveEntry(ownerId: string, entryId: string, draft: EntryDraft, previousDate?: string): Promise<void> {
  return enqueue(ownerId, previousDate ?? draft.preview.date, { type: 'upsert', entryId, body: draft.body, preview: draft.preview })
}

export async function deleteEntry(ownerId: string, date: string, entryId: string): Promise<void> {
  await db.transaction('rw', db.diaryOps, async () => {
    const rows = await db.diaryOps.where('ownerId').equals(ownerId).toArray()
    const rejected = rows.filter((op) => op.type === 'upsert' && op.entryId === entryId && op.error)
    await db.diaryOps.bulkDelete(rejected.map((op) => op.id))
    await addQueuedOp(ownerId, date, { type: 'delete', entryId })
  })
  requestSync()
}

/** Clear errors after the user has reviewed them, without deleting confirmed data. */
export async function discardRejectedDayOps(ownerId: string, date: string): Promise<void> {
  const rows = await db.diaryOps.where('ownerId').equals(ownerId).toArray()
  await db.diaryOps.bulkDelete(rows.filter((op) => op.error && (op.date === date || (op.type === 'upsert' && op.preview.date === date))).map((op) => op.id))
}

export function setDayStatus(ownerId: string, date: string, status: DayStatus): Promise<void> {
  return enqueue(ownerId, date, { type: 'status', status })
}

/** Pamti namirnicu kao nedavno korišćenu (i za unos bez interneta). */
export async function rememberFood(ownerId: string, food: Food): Promise<void> {
  await db.foodCache.put({ key: `${ownerId}:${food.id}`, ownerId, food, usedAt: new Date().toISOString() })
}

export async function cachedFood(ownerId: string, foodId: string): Promise<Food | undefined> {
  return (await db.foodCache.get(`${ownerId}:${foodId}`))?.food
}

/** Neposlate izmene koje se tiču dana (i stavke premeštene u taj dan ili iz njega). */
async function opsFor(ownerId: string, date: string): Promise<DiaryOpRow[]> {
  const ops = await db.diaryOps.where('ownerId').equals(ownerId).toArray()
  return ops.filter((op) => op.date === date || (op.type === 'upsert' && op.preview.date === date))
}

/** Stavke dana za kopiranje: sa servera ako ima interneta, inače poslednje sačuvane; uz neposlate izmene. */
export async function loadDayEntries(ownerId: string, date: string): Promise<DiaryEntry[]> {
  let server: DiaryDay | null
  try {
    server = (await api.get<DiaryDay>(`/nutrition/days/${date}/`, { timeout: 5000 })).data
    await cacheDay(ownerId, server)
  } catch {
    server = (await db.diaryDays.get(dayKey(ownerId, date)))?.day ?? null
  }
  return applyOps(date, server, await opsFor(ownerId, date)).entries
}

/** Više novih stavki odjednom (kopiran ili sačuvan obrok), redom kojim su navedene. */
export async function saveDrafts(ownerId: string, drafts: EntryDraft[]): Promise<void> {
  if (!drafts.length) return
  // One saved meal is one operation: no partial meals if the device/storage fails.
  await db.transaction('rw', db.diaryOps, async () => {
    for (const draft of drafts) {
      await addQueuedOp(ownerId, draft.preview.date, {
        type: 'upsert', entryId: draft.preview.id, body: draft.body, preview: draft.preview,
      })
    }
  })
  requestSync()
}

export async function cacheDay(ownerId: string, day: DiaryDay): Promise<void> {
  await db.diaryDays.put({ key: dayKey(ownerId, day.date), ownerId, day, fetchedAt: new Date().toISOString() })
}

/**
 * Dan za prikaz: poslednje stanje sa servera (sačuvano na telefonu) + neposlate izmene.
 * Kad ima interneta, stanje se osvežava sa servera; bez interneta se koristi sačuvano.
 */
export function useDiaryDay(ownerId: string | undefined, date: string): { day: DisplayDay | undefined; offline: boolean } {
  const remote = useQuery({
    queryKey: ['diary', date],
    queryFn: async () => (await api.get<DiaryDay>(`/nutrition/days/${date}/`)).data,
    enabled: !!ownerId,
    retry: false,
  })

  useEffect(() => {
    if (ownerId && remote.data) void cacheDay(ownerId, remote.data)
  }, [ownerId, remote.data])

  const day = useLiveQuery(async () => {
    if (!ownerId) return undefined
    const row = await db.diaryDays.get(dayKey(ownerId, date))
    return applyOps(date, row?.day ?? null, await opsFor(ownerId, date))
  }, [ownerId, date, remote.data])

  return { day, offline: remote.isError }
}

/** Nedavne namirnice: sa servera kad ima interneta, inače one sačuvane na telefonu. */
export function useRecentFoods(ownerId: string | undefined): Food[] | undefined {
  const remote = useQuery({
    queryKey: ['recent-foods'],
    queryFn: async () => (await api.get<Food[]>('/nutrition/recent-foods/')).data,
    enabled: !!ownerId,
    retry: false,
  })
  const local = useLiveQuery(
    async () => (ownerId ? (await db.foodCache.where('ownerId').equals(ownerId).sortBy('usedAt')).reverse().map((r) => r.food) : []),
    [ownerId],
  )
  if (remote.data) {
    // Preserve local recency order, but take current values from the server.
    const fresh = new Map(remote.data.map((food) => [food.id, food]))
    const seen = new Set<string>()
    return [...(local ?? []).slice(0, 5), ...remote.data]
      .map((food) => fresh.get(food.id) ?? food)
      .filter((food) => !seen.has(food.id) && seen.add(food.id))
  }
  return local
}
