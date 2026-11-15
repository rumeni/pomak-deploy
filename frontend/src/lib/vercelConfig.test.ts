import { describe, expect, it } from 'vitest'
import vercelConfig from '../../vercel.json'

describe('Vercel same-origin API rewrite', () => {
  it('forwards Django URLs including trailing slashes before the SPA fallback', () => {
    const [api, fallback] = vercelConfig.rewrites
    const source = new RegExp(`^${api.source}$`)
    for (const path of ['/api/health/', '/api/auth/login/', '/api/auth/refresh/', '/api/auth/logout/']) {
      expect(source.test(path)).toBe(true)
      expect(path.replace(source, api.destination)).toBe(
        `https://pomak-api.vercel.app${path}`,
      )
    }
    expect(fallback.source).toBe('/(.*)')
    expect(fallback.destination).toBe('/index.html')
  })
})
