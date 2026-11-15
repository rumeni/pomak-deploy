import { db, type DiaryOpRow } from '../../lib/db'
import { classifySendError } from '../workout/outbox'

let running: Promise<Set<string>> | null = null

/**
 * Šalje neposlate izmene dnevnika jednog korisnika, redom. Staje na prvoj privremenoj
 * grešci (nema interneta); odbijena izmena dobija poruku i ne šalje se ponovo.
 * Vraća datume čije stanje na serveru se promenilo (da se osveže).
 */
export function syncDiary(ownerId: string, send: (op: DiaryOpRow) => Promise<unknown>): Promise<Set<string>> {
  running ??= (async () => {
    const changed = new Set<string>()
    const ops = (await db.diaryOps.where('ownerId').equals(ownerId).sortBy('seq')).filter((o) => !o.error)
    for (const op of ops) {
      try {
        await send(op)
        await db.diaryOps.delete(op.id)
        changed.add(op.date)
        if (op.type === 'upsert') changed.add(op.preview.date)
      } catch (error) {
        const { result, message } = classifySendError(error)
        if (result === 'retry-later') break
        await db.diaryOps.update(op.id, { error: message })
        changed.add(op.date)
      }
    }
    return changed
  })().finally(() => {
    running = null
  })
  return running
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
