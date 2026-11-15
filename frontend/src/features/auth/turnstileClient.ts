/** Browser-side Turnstile wiring kept separate for lifecycle/error regression tests. */
export type TurnstileApi = {
  render: (target: HTMLElement, options: {
    sitekey: string
    action: string
    callback: (token: string) => void
    'expired-callback': () => void
    'error-callback': () => void
  }) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export function attachTurnstile(
  target: HTMLElement, sitekey: string,
  onToken: (token: string | null) => void, onFailure: () => void,
): () => void {
  let active = true
  let widgetId: string | null = null
  let script = document.querySelector<HTMLScriptElement>('script[data-pomak-turnstile]')
  const fail = () => {
    if (!active) return
    onToken(null)
    onFailure()
    // An external script which failed to load must be replaced on retry.
    if (!window.turnstile) script?.remove()
  }
  const render = () => {
    if (!active || !window.turnstile || widgetId !== null) return
    try {
      widgetId = window.turnstile.render(target, {
        sitekey,
        action: 'pomak_login_recovery',
        callback: (token) => { if (active) onToken(token) },
        'expired-callback': () => { if (active) onToken(null) },
        'error-callback': fail,
      })
    } catch {
      fail()
    }
  }
  const onLoad = () => {
    if (!window.turnstile) fail()
    else render()
  }
  if (!script) {
    script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.dataset.pomakTurnstile = 'true'
    document.head.appendChild(script)
  }
  script.addEventListener('load', onLoad)
  script.addEventListener('error', fail)
  render()
  return () => {
    active = false
    script?.removeEventListener('load', onLoad)
    script?.removeEventListener('error', fail)
    if (widgetId !== null) window.turnstile?.remove(widgetId)
  }
}
