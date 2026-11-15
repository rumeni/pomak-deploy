import axios from 'axios'
import i18n, { toServerLanguage, type Language } from '../i18n'
import { api, revokePendingWebLogout, webHeaders } from './api'
import type { RegisterData } from './authContext'
import { tokens } from './tokens'

/** A failed offline logout must not prevent a new, server-verified signup. */
export async function performRegistration({ email, password, displayName, accountType }: RegisterData): Promise<void> {
  const previousLogout = tokens.pendingWebLogout()
  if (previousLogout) {
    try {
      await revokePendingWebLogout()
    } catch {
      // The server revokes the previous refresh cookie transactionally
      // before issuing the new registration cookie.
    }
  }
  const { data } = await api.post('/auth/register/', {
    email,
    password,
    display_name: displayName,
    account_type: accountType,
    language: toServerLanguage(i18n.language as Language),
  })
  if (Object.keys(webHeaders()).length) {
    if (data.refresh) {
      // Older API releases may still return the registration refresh in JSON.
      const migrated = await axios.post(`${api.defaults.baseURL}/auth/refresh/`, {
        refresh: data.refresh,
      }, { headers: webHeaders(), timeout: 15000 })
      await tokens.set(migrated.data.access, null)
    } else {
      await tokens.set(data.access, null)
    }
  } else {
    await tokens.set(data.access, data.refresh)
  }
  if (previousLogout) tokens.completeWebLogout(previousLogout)
}
