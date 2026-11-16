import { db, type DiaryOpRow } from '../../lib/db'
import { withDiarySyncLock } from './syncLock'
import { classifySendError } from '../workout/outbox'

const running = new Map<string, Promise<Set<string>>>()

/**
 * Serialize the entire HTTP + IndexedDB batch across independent browser tabs.
 * A per-module promise protects repeat calls within one tab, but cannot
 * protect another tab, which is why the cross-tab lock is also required.
 */
export function syncDiary(
  ownerId: string, send: (op: DiaryOpRow) => Promise<unknown>,
  isCurrent: () => boolean = () => true, sessionKey = '',
): Promise<Set<string>> {
  const key = `${ownerId}:${sessionKey}`
  const existing = running.get(key)
  if (existing) return existing
  const task = withDiarySyncLock(ownerId, isCurrent, async (stillCurrent, beforeSend) => {
    const changed = new Set<string>()
    // IMPORTANT: load the queue AFTER taking the owner lock, so another tab
    // cannot replay a stale snapshot after its predecessor finished.
    const ops = (await db.diaryOps.where('ownerId').equals(ownerId).sortBy('seq')).filter((o) => !o.error)
    for (const op of ops) {
      if (!stillCurrent()) break
      const latest = await db.diaryOps.get(op.id)
      if (!latest || latest.ownerId !== ownerId || latest.error) continue
      if (!stillCurrent() || !await beforeSend()) break
      try {
        await send(latest)
        if (!stillCurrent() || !await beforeSend()) break
        await db.diaryOps.delete(latest.id)
        changed.add(latest.date)
        if (latest.type === 'upsert') changed.add(latest.preview.date)
      } catch (error) {
        if (!stillCurrent() || !await beforeSend()) break
        const { result, message } = classifySendError(error)
        if (result === 'retry-later') break
        await db.diaryOps.update(latest.id, { error: message })
        changed.add(latest.date)
      }
    }
    return changed
  }, () => new Set<string>())
  const tracked = task.finally(() => { if (running.get(key) === tracked) running.delete(key) })
  running.set(key, tracked)
  return tracked
}

/** Kako se svaka izmena šalje serveru; sve su bezbedne za ponovno slanje. */
export function diaryRequest(op: DiaryOpRow): { method: 'put' | 'delete'; url: string; body?: unknown } {
  switch (op.type) {
    case 'upsert':
      return { method: 'put', url: `/nutrition/entries/${op.entryId}/`, body: op.body }
    case 'delete':
      return { method: 'delete', url: `/nutrition/entries/${op.entryId}/` }
    case 'status':
      return { method: 'put', url: `/nutrition/days/${op.date}/`, body: { status: op.status } }
  }
}
