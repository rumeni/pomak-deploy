import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { LoginChallenge } from './LoginChallenge'

describe('LoginChallenge initial UI', () => {
  it('renders an accessible challenge container without eagerly loading external scripts', () => {
    const html = renderToStaticMarkup(<LoginChallenge sitekey="site-key" onToken={() => undefined} />)
    expect(html).toContain('aria-label="auth.verificationLabel"')
    expect(html).not.toContain('challenges.cloudflare.com')
    expect(html).not.toContain('auth.verificationRetry')
  })
})
