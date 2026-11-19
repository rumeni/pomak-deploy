/** Whether the "confirm every set" hint was dismissed, per account on this device. */
const KEY = 'pomak.confirmSetsHint.'

export function confirmHintSeen(ownerId: string): boolean {
  try {
    return localStorage.getItem(KEY + ownerId) === '1'
  } catch {
    return false // private mode: shown until dismissed in this session
  }
}

export function markConfirmHintSeen(ownerId: string): void {
  try {
    localStorage.setItem(KEY + ownerId, '1')
  } catch {
    // Not remembered; dismissed for now.
  }
}
