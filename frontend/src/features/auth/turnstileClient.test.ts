import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachTurnstile } from './turnstileClient'

type Handler = () => void
function fakeScript() {
  const handlers: Record<string, Handler> = {}
  return {
    src: '', async: false, dataset: {} as Record<string, string>,
    addEventListener: vi.fn((name: string, fn: Handler) => { handlers[name] = fn }),
    removeEventListener: vi.fn((name: string) => { delete handlers[name] }),
    remove: vi.fn(),
    emit: (name: string) => handlers[name]?.(),
  }
}
let script: ReturnType<typeof fakeScript> | null
beforeEach(() => {
  script = null
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => script),
    createElement: vi.fn(() => { script = fakeScript(); return script }),
    head: { appendChild: vi.fn() },
  })
  vi.stubGlobal('window', {})
})
afterEach(() => { vi.unstubAllGlobals() })

describe('LoginChallenge Turnstile client', () => {
  it('loads lazily, binds the action, delivers tokens and clears expired tokens', () => {
    const onToken = vi.fn(), onFailure = vi.fn()
    let handlers: Record<string, unknown> = {}
    const turnstile = {
      render: vi.fn((_target: HTMLElement, opts: Record<string, unknown>) => {
        handlers = opts
        return 'widget-1'
      }),
      remove: vi.fn(),
    }
    const target = {} as HTMLElement
    const detach = attachTurnstile(target, 'site-key', onToken, onFailure)
    expect(script?.src).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js')
    expect(turnstile.render).not.toHaveBeenCalled()
    ;(window as { turnstile?: unknown }).turnstile = turnstile
    script?.emit('load')
    script?.emit('load')
    expect(turnstile.render).toHaveBeenCalledTimes(1)
    expect(handlers.sitekey).toBe('site-key')
    expect(handlers.action).toBe('pomak_login_recovery')
    ;(handlers.callback as (value: string) => void)('token')
    expect(onToken).toHaveBeenLastCalledWith('token')
    ;(handlers['expired-callback'] as () => void)()
    expect(onToken).toHaveBeenLastCalledWith(null)
    detach()
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1')
    ;(handlers.callback as (value: string) => void)('stale')
    expect(onToken).toHaveBeenCalledTimes(2)
  })

  it('rejects a failed script and creates a new one when retried', () => {
    const onToken = vi.fn(), onFailure = vi.fn()
    const first = attachTurnstile({} as HTMLElement, 'site-key', onToken, onFailure)
    const old = script!
    old.emit('error')
    expect(onToken).toHaveBeenCalledWith(null)
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(old.remove).toHaveBeenCalledTimes(1)
    first()
    script = null // Browser has removed the broken element.
    const second = attachTurnstile({} as HTMLElement, 'site-key', onToken, onFailure)
    expect(script).not.toBe(old)
    second()
  })

  it('fails closed if the script loads without Turnstile available', () => {
    const onToken = vi.fn(), onFailure = vi.fn()
    const detach = attachTurnstile({} as HTMLElement, 'site-key', onToken, onFailure)
    script?.emit('load')
    expect(onToken).toHaveBeenCalledWith(null)
    expect(onFailure).toHaveBeenCalledTimes(1)
    detach()
  })
})
