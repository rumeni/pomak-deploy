/**
 * ID prijavljenog korisnika za lokalne podatke (aktivan trening, red za slanje).
 * Postavlja ga AuthProvider; lokalni zapisi drugog naloga se ne prikazuju niti šalju.
 */
let currentUserId: string | null = null

export function setCurrentUserId(id: string | null): void {
  currentUserId = id
}

export function getCurrentUserId(): string | null {
  return currentUserId
}
