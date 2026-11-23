import { db } from '../../lib/db'
import { clearUserEditDrafts, countEditDrafts } from './edit'
import { clearUserPendingPrograms } from '../training/programs'
import { cancelRestEnd } from './restNotification'

/** Koliko lokalnih podataka naloga još nije na serveru: treninzi, izmene dnevnika i nesačuvane ispravke treninga (za upozorenje pri odjavi). */
export async function unsentSummary(ownerId: string): Promise<{ active: boolean; pending: number }> {
  const row = await db.activeWorkout.get(ownerId)
  const pending =
    (await db.outbox.where('ownerId').equals(ownerId).count()) + (await db.diaryOps.where('ownerId').equals(ownerId).count())
    + countEditDrafts(ownerId)
  return { active: row?.ownerId === ownerId, pending }
}

/** Briše lokalne podatke naloga sa telefona (pri odjavi, posle potvrde korisnika). */
export async function clearLocalData(ownerId: string, accountDeleted = false): Promise<void> {
  await db.transaction('rw', [db.activeWorkout, db.outbox, db.diaryOps, db.diaryDays, db.foodCache, db.historyCache], async () => {
    const row = await db.activeWorkout.get(ownerId)
    if (row?.ownerId === ownerId) await db.activeWorkout.delete(ownerId)
    // Logout retains only minimal remote-delete tombstones so a later login
    // can reconcile them. Once the ACCOUNT is deleted, the remote data is gone
    // and absolutely every local record (including tombstones) must be purged.
    if (accountDeleted) await db.outbox.where('ownerId').equals(ownerId).delete()
    else await db.outbox.where('ownerId').equals(ownerId)
      .filter((row) => !row.deleteRequested).delete()
    await db.diaryOps.where('ownerId').equals(ownerId).delete()
    await db.diaryDays.where('ownerId').equals(ownerId).delete()
    await db.foodCache.where('ownerId').equals(ownerId).delete()
    await db.historyCache.where('ownerId').equals(ownerId).delete()
  })
  // Unsaved workout corrections and unfinished program imports are this account's data too.
  clearUserEditDrafts(ownerId)
  clearUserPendingPrograms(ownerId)
  await cancelRestEnd()
}
