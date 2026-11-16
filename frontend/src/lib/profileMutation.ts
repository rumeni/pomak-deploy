import type { AuthScope, ScopedRequestConfig } from './api'
import { api, scopeIsCurrent } from './api'
import { tokens } from './tokens'
import type { Me, Profile } from './types'

/** Bind a profile mutation to the account AND login session that started it. */
export function profileScope(ownerId: string): AuthScope {
  return { ownerId, session: tokens.session() }
}

/** Responses from an old login must never repopulate the new login's shared cache. */
export function acceptsProfileResponse(
  scope: AuthScope, data: Me, current: (scope: AuthScope) => boolean = scopeIsCurrent,
): boolean {
  return data.id === scope.ownerId && current(scope)
}

export async function patchOwnProfile(ownerId: string, profile: Partial<Profile>, scope: AuthScope = profileScope(ownerId)): Promise<Me | null> {
  if (!scopeIsCurrent(scope)) return null
  const config: ScopedRequestConfig = { __pomakScope: scope }
  const { data } = await api.patch<Me>('/auth/me/', { profile }, config)
  return acceptsProfileResponse(scope, data) ? data : null
}
