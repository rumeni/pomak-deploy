/** Account deletion remains accessible to authenticated users even if email verification or onboarding is pending. */
export function canAccessAccountDeletion(path: string, isAuthenticated: boolean): boolean {
  return isAuthenticated && path === '/profil/obrisi-nalog'
}
