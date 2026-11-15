import Dexie, { type EntityTable } from 'dexie'

import type { DayStatus, DiaryDay, DiaryEntry, EntryWrite } from '../features/diary/types'
import type { Food } from '../features/nutrition/api'
import type { Exercise } from '../features/training/api'
import type { ActiveWorkout, SessionPayload } from '../features/workout/model'

/** Aktivan trening; uvek najviše jedan, pod ključem "current". */
export interface ActiveWorkoutRow {
  slot: 'current'
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
