import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { attachTurnstile } from './turnstileClient'

/** Loaded only when the server reports an exhausted account quota. */
export function LoginChallenge({ sitekey, onToken }: { sitekey: string; onToken: (token: string | null) => void }) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!container.current) return
    return attachTurnstile(container.current, sitekey, onToken, () => setFailed(true))
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
