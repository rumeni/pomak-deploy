import { db } from '../../lib/db'
import { cancelRestEnd } from './restNotification'

/** Koliko lokalnih podataka naloga još nije na serveru: treninzi i izmene dnevnika (za upozorenje pri odjavi). */
export async function unsentSummary(ownerId: string): Promise<{ active: boolean; pending: number }> {
  const row = await db.activeWorkout.get('current')
  const pending =
    (await db.outbox.where('ownerId').equals(ownerId).count()) + (await db.diaryOps.where('ownerId').equals(ownerId).count())
  return { active: row?.ownerId === ownerId, pending }
}

/** Briše lokalne podatke naloga sa telefona (pri odjavi, posle potvrde korisnika). */
export async function clearLocalData(ownerId: string): Promise<void> {
  await db.transaction('rw', [db.activeWorkout, db.outbox, db.diaryOps, db.diaryDays, db.foodCache], async () => {
    const row = await db.activeWorkout.get('current')
    if (row?.ownerId === ownerId) await db.activeWorkout.delete('current')
    await db.outbox.where('ownerId').equals(ownerId).delete()
    await db.diaryOps.where('ownerId').equals(ownerId).delete()
    await db.diaryDays.where('ownerId').equals(ownerId).delete()
    await db.foodCache.where('ownerId').equals(ownerId).delete()
  })
  await cancelRestEnd()
}
