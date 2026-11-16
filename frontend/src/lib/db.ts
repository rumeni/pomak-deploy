import Dexie, { type EntityTable } from 'dexie'

import type { DayStatus, DiaryDay, DiaryEntry, EntryWrite } from '../features/diary/types'
import type { Food } from '../features/nutrition/api'
import type { Exercise } from '../features/training/api'
import type { ActiveWorkout, SessionPayload } from '../features/workout/model'

/** At most one unfinished workout per account, keyed by its owner ID. */
export interface ActiveWorkoutRow {
  slot: string
  /** Nalog kome trening pripada; na istom telefonu može da se prijavi više ljudi. */
  ownerId: string
  workout: ActiveWorkout
}

/** Završen trening koji čeka slanje na server (npr. nije bilo interneta). */
export interface OutboxRow {
  id: string
  ownerId: string
  payload: SessionPayload
  /** Vežbe za prikaz u istoriji dok trening nije poslat (payload ima samo ID-jeve). */
  exercises: Exercise[]
  queuedAt: string
  attempts: number
  /** At least one POST may already have reached the server, even after a network error. */
  sendingAt?: number | null
  /** Durable delete intent: do not re-POST; reconcile with DELETE after reconnection. */
  deleteRequested?: boolean
  deletingAt?: number | null
  /** Poruka servera ako je trening odbijen; takav zapis se ne šalje ponovo sam od sebe. */
  error: string | null
}

/** Poslednje stanje dana sa servera (za prikaz bez interneta). Ključ: "<ownerId>:<datum>". */
export interface DiaryDayRow {
  key: string
  ownerId: string
  day: DiaryDay
  fetchedAt: string
}

/** Neposlata izmena dnevnika. Šalju se redom (`seq`); svaka je bezbedna za ponovno slanje. */
export type DiaryOpRow = {
  id: string
  ownerId: string
  date: string
  seq: number
  /** Poruka servera ako je izmena odbijena; takva se ne šalje ponovo. */
  error: string | null
} & (
  | { type: 'upsert'; entryId: string; body: EntryWrite; preview: DiaryEntry }
  | { type: 'delete'; entryId: string }
  | { type: 'status'; status: DayStatus }
)

/** Recoverable cross-tab lease for diary sync when Web Locks are unavailable. */
export interface DiarySyncLeaseRow {
  key: string
  holder: string
  expiresAt: number
}

/** Namirnica koju je korisnik koristio: "Nedavno" i unos bez interneta. */
export interface FoodCacheRow {
  key: string
  ownerId: string
  food: Food
  usedAt: string
}

/** Lokalna baza u pregledaču/telefonu (IndexedDB). Opstaje kad se aplikacija zatvori. */
export const db = new Dexie('pomak') as Dexie & {
  activeWorkout: EntityTable<ActiveWorkoutRow, 'slot'>
  outbox: EntityTable<OutboxRow, 'id'>
  diaryDays: EntityTable<DiaryDayRow, 'key'>
  diaryOps: EntityTable<DiaryOpRow, 'id'>
  foodCache: EntityTable<FoodCacheRow, 'key'>
  diarySyncLeases: EntityTable<DiarySyncLeaseRow, 'key'>
}

db.version(1).stores({
  activeWorkout: 'slot',
})

db.version(2)
  .stores({
    activeWorkout: 'slot',
    outbox: 'id, ownerId',
  })
  // Zapisi iz verzije 1 nemaju vlasnika i postojali su samo tokom razvoja.
  .upgrade((tx) => tx.table('activeWorkout').clear())

db.version(3).stores({
  activeWorkout: 'slot',
  outbox: 'id, ownerId',
  diaryDays: 'key, ownerId',
  diaryOps: 'id, [ownerId+date], ownerId, seq',
  foodCache: 'key, ownerId, usedAt',
})

/**
 * Re-key a pre-existing global "current" workout on an IndexedDB upgrade.
 * Do not drop its sets: account A's offline workout must survive a login by B.
 * The upgrade callback runs transactionally; all other local stores persist.
 */
db.version(4).stores({
  activeWorkout: 'slot',
}).upgrade(async (tx) => {
  const table = tx.table('activeWorkout')
  const legacy = await table.get('current') as ActiveWorkoutRow | undefined
  if (legacy?.ownerId) {
    if (!(await table.get(legacy.ownerId))) {
      await table.put({ ...legacy, slot: legacy.ownerId })
    }
    await table.delete('current')
  }
})


/** Add-only store: upgrading a device must never clear its existing offline diary. */
db.version(5).stores({
  diarySyncLeases: 'key',
})
