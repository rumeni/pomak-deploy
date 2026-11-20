import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../components/LanguageMenu', () => ({ LanguageMenu: () => <span>Language</span> }))

import { AuthLayout } from './AuthLayout'

describe('mobile login layout', () => {
  it('supports a compact login form without removing the brand or language switcher', () => {
    const markup = renderToStaticMarkup(<AuthLayout title="Log in" compact><form><input aria-label="Email" /></form></AuthLayout>)
    expect(markup).toContain('auth-stage--compact')
    expect(markup).toContain('auth-panel-brand')
    expect(markup).toContain('POMAK')
    expect(markup).toContain('Log in')
    expect(markup).toContain('Language')
    expect(markup).toContain('aria-label="Email"')
  })
})
