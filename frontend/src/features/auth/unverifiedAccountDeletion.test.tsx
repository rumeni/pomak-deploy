import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../lib/api', () => ({ api: { post: vi.fn() }, errorMessage: () => 'error' }))
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ me: { email: 'pending@example.test' }, logout: vi.fn() }),
}))
vi.mock('../../components/LanguageMenu', () => ({ LanguageMenu: () => null }))

import { EmailVerificationPendingPage } from './AccountEmailPages'

describe('pending verification page', () => {
  it('links to account deletion when email cannot be verified', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/danas']}>
        <EmailVerificationPendingPage />
      </MemoryRouter>,
    )
    expect(html).toContain('href="/profil/obrisi-nalog"')
    expect(html).toContain('accountSecurity.deleteUnverifiedAccount')
  })
})
