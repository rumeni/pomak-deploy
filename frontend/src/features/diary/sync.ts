import { db, type DiaryOpRow } from '../../lib/db'
import { classifySendError } from '../workout/outbox'

const running = new Map<string, Promise<Set<string>>>()

/** Never mix concurrent syncs of separate users or auth sessions. */
export function syncDiary(
  ownerId: string, send: (op: DiaryOpRow) => Promise<unknown>,
  isCurrent: () => boolean = () => true, sessionKey = '',
): Promise<Set<string>> {
  const key = `${ownerId}:${sessionKey}`
  const existing = running.get(key)
  if (existing) return existing
  const task = (async () => {
    const changed = new Set<string>()
    const ops = (await db.diaryOps.where('ownerId').equals(ownerId).sortBy('seq')).filter((o) => !o.error)
    for (const op of ops) {
      if (!isCurrent()) break
      if (!(await db.diaryOps.get(op.id))) continue
      if (!isCurrent()) break
      try {
        await send(op)
        if (!isCurrent()) break
        await db.diaryOps.delete(op.id)
        changed.add(op.date)
        if (op.type === 'upsert') changed.add(op.preview.date)
      } catch (error) {
        if (!isCurrent()) break
        const { result, message } = classifySendError(error)
        if (result === 'retry-later') break
        await db.diaryOps.update(op.id, { error: message })
        changed.add(op.date)
      }
    }
    return changed
  })()
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
