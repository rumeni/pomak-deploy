import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TurnstileApi = {
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

/** Loaded only when the server reports an exhausted account quota. */
export function LoginChallenge({ sitekey, onToken }: { sitekey: string; onToken: (token: string | null) => void }) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let widgetId: string | null = null
    const render = () => {
      if (!active || !container.current || !window.turnstile || widgetId !== null) return
      try {
        widgetId = window.turnstile.render(container.current, {
          sitekey,
          action: 'pomak_login_recovery',
          callback: (token) => { if (active) onToken(token) },
          'expired-callback': () => { if (active) onToken(null) },
          'error-callback': () => { if (active) { onToken(null); setFailed(true) } },
        })
      } catch {
        if (active) setFailed(true)
      }
    }
    const fail = () => { if (active) setFailed(true) }
    let script = document.querySelector<HTMLScriptElement>('script[data-pomak-turnstile]')
    if (!script) {
      script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.dataset.pomakTurnstile = 'true'
      document.head.appendChild(script)
    }
    script.addEventListener('load', render)
    script.addEventListener('error', fail)
    render()
    return () => {
      active = false
      script?.removeEventListener('load', render)
      script?.removeEventListener('error', fail)
      if (widgetId !== null) window.turnstile?.remove(widgetId)
    }
  }, [sitekey, onToken])

  return (
    <div className="flex flex-col gap-2">
      <div ref={container} aria-label={t('auth.verificationLabel')} />
      {failed && <p role="alert" className="text-sm text-danger">{t('auth.verificationUnavailable')}</p>}
    </div>
  )
}
