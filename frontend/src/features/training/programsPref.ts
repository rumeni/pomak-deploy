import { useSyncExternalStore } from 'react'

/**
 * Whether the suggested programs are hidden on the training screen, per account on this device.
 * Changes are announced in the same tab (Profil ↔ Trening) and picked up from other tabs.
 */
const KEY = 'pomak.hidePrograms.'
const EVENT = 'pomak:programs-pref'
// Only for a choice storage could not save (private mode, quota): it then holds for this
// session. A readable missing key simply means "shown".
const unsaved = new Map<string, boolean>()

export function programsHidden(ownerId: string): boolean {
  const session = unsaved.get(ownerId)
  if (session !== undefined) return session
  try {
    return localStorage.getItem(KEY + ownerId) === '1'
  } catch {
    return false
  }
}

export function setProgramsHidden(ownerId: string, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(KEY + ownerId, '1')
    else localStorage.removeItem(KEY + ownerId)
    unsaved.delete(ownerId)
  } catch {
    unsaved.set(ownerId, hidden)
  }
  window.dispatchEvent(new Event(EVENT))
}

/** A change made in another tab is newer than an unsaved choice of this one. */
function onStorage(event: StorageEvent): boolean {
  if (event.key === null) {
    unsaved.clear()
    return true
  }
  if (!event.key.startsWith(KEY)) return false
  unsaved.delete(event.key.slice(KEY.length))
  return true
}

export function subscribeProgramsHidden(onChange: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (onStorage(event)) onChange()
  }
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', storage)
  }
}

export function useProgramsHidden(ownerId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribeProgramsHidden,
    () => (ownerId ? programsHidden(ownerId) : false),
    () => false,
  )
}
