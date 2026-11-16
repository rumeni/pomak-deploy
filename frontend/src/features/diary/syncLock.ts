import { db } from '../../lib/db'
import { uuid } from '../../lib/uuid'

// The HTTP timeout is 15 seconds. This much longer fallback lease covers
// token refresh and delayed background tabs; a terminated tab recovers.
const LEASE_MS = 120_000
const HEARTBEAT_MS = 10_000

/**
 * The Web Locks API guarantees exclusive access across tabs while awaiting
 * network responses. On older browsers, use an atomic IndexedDB lease rather
 * than allowing simultaneous uploads. The lease is periodically renewed and
 * has a finite expiry for recovery after a tab/browser crash.
 */
export async function withDiarySyncLock<T>(
  ownerId: string,
  isCurrent: () => boolean,
  work: (stillCurrent: () => boolean) => Promise<T>,
  skipped: () => T,
): Promise<T> {
  if (!isCurrent()) return skipped()
  const lockKey = `pomak:diary-sync:${ownerId}`
  const webLocks = typeof navigator === 'undefined' ? undefined : navigator.locks

  if (webLocks?.request) {
    return webLocks.request(lockKey, async () => (
      isCurrent() ? work(isCurrent) : skipped()
    ))
  }

  // IndexedDB read/compare/write is transactional even across separate tabs.
  const holder = uuid()
  const acquired = await db.transaction('rw', db.diarySyncLeases, async () => {
    const previous = await db.diarySyncLeases.get(lockKey)
    if (previous && previous.expiresAt > Date.now()) return false
    await db.diarySyncLeases.put({ key: lockKey, holder, expiresAt: Date.now() + LEASE_MS })
    return true
  })
  if (!acquired) return skipped()

  let lost = false
  const stillCurrent = () => !lost && isCurrent()
  // Retain the lease through HTTP requests (not only IndexedDB writes).
  // If a long-suspended tab loses its lease, it must stop processing.
  const heartbeat = setInterval(() => {
    void db.transaction('rw', db.diarySyncLeases, async () => {
      const lease = await db.diarySyncLeases.get(lockKey)
      if (!lease || lease.holder !== holder) {
        lost = true
        return
      }
      await db.diarySyncLeases.update(lockKey, { expiresAt: Date.now() + LEASE_MS })
    }).catch(() => { lost = true })
  }, HEARTBEAT_MS)

  try {
    return stillCurrent() ? await work(stillCurrent) : skipped()
  } finally {
    clearInterval(heartbeat)
    await db.transaction('rw', db.diarySyncLeases, async () => {
      const lease = await db.diarySyncLeases.get(lockKey)
      if (lease?.holder === holder) await db.diarySyncLeases.delete(lockKey)
    })
  }
}
