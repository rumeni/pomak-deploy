import { useSyncExternalStore } from 'react'

/**
 * Whether the suggested programs are hidden on the training screen, per account on this device.
 * Changes are announced in the same tab (Profil ↔ Trening) and picked up from other tabs.
 */
const KEY = 'pomak.hidePrograms.'
const EVENT = 'pomak:programs-pref'
// Without storage (private mode) the choice still holds for this session.
const memory = new Map<string, boolean>()

export function programsHidden(ownerId: string): boolean {
  try {
    const stored = localStorage.getItem(KEY + ownerId)
    if (stored !== null) return stored === '1'
  } catch {
    // fall through to the session value
  }
  return memory.get(ownerId) ?? false
}

export function setProgramsHidden(ownerId: string, hidden: boolean): void {
  memory.set(ownerId, hidden)
  try {
    if (hidden) localStorage.setItem(KEY + ownerId, '1')
    else localStorage.removeItem(KEY + ownerId)
  } catch {
    // Remembered for this session only.
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useProgramsHidden(ownerId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (ownerId ? programsHidden(ownerId) : false),
    () => false,
  )
}
