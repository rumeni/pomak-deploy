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
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let widgetId: string | null = null
    let script = document.querySelector<HTMLScriptElement>('script[data-pomak-turnstile]')
    const fail = () => {
      if (!active) return
      onToken(null)
      setFailed(true)
      // A failed external script element won't fire "load" again after the
      // network returns; discard it so the retry can fetch a fresh copy.
      if (!window.turnstile) script?.remove()
    }
    const render = () => {
      if (!active || !container.current || !window.turnstile || widgetId !== null) return
      try {
        widgetId = window.turnstile.render(container.current, {
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
  }, [sitekey, onToken, attempt])

  return (
    <div className="flex flex-col gap-2">
      <div ref={container} aria-label={t('auth.verificationLabel')} />
      {failed && (
        <>
          <p role="alert" className="text-sm text-danger">{t('auth.verificationUnavailable')}</p>
          <button type="button" className="text-sm font-semibold text-brand-dark underline" onClick={() => {
            onToken(null)
            setFailed(false)
            setAttempt((value) => value + 1)
          }}>
            {t('auth.verificationRetry')}
          </button>
        </>
      )}
    </div>
  )
}
