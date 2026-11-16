import axios from 'axios'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import { Button, Field, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AuthLayout } from './AuthLayout'
import { LoginChallenge } from './LoginChallenge'

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [verificationRequired, setVerificationRequired] = useState(false)
  const [verificationToken, setVerificationToken] = useState<string | null>(null)
  const [challengeEpoch, setChallengeEpoch] = useState(0)
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

  const schema = useMemo(
    () =>
      z.object({
        email: z.email(t('auth.invalidEmail')),
        password: z.string().min(1, t('auth.enterPassword')),
      }),
    [t],
  )
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null)
    try {
      await login(email, password, verificationRequired ? verificationToken ?? undefined : undefined)
    } catch (e) {
      if (verificationRequired) {
        setVerificationToken(null)
        setChallengeEpoch((value) => value + 1)
      }
      if (axios.isAxiosError(e) && e.response?.status === 429 && e.response?.data?.code === 'login_verification_required') {
        setVerificationRequired(true)
        setError(t(sitekey ? 'auth.verificationPrompt' : 'auth.verificationUnavailable'))
      } else {
        setError(errorMessage(e))
      }
    }
  })

  return (
    <AuthLayout title={t('auth.loginTitle')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label={t('auth.email')} type="email" autoComplete="email" inputMode="email" {...register('email')} error={formState.errors.email?.message} />
        <Field label={t('auth.password')} type="password" autoComplete="current-password" {...register('password')} error={formState.errors.password?.message} />
        <FormError message={error} />
        {verificationRequired && sitekey && (
          <LoginChallenge key={challengeEpoch} sitekey={sitekey} onToken={setVerificationToken} />
        )}
        {verificationRequired && (
          <button type="button" className="text-sm font-semibold text-brand-dark underline" onClick={() => {
            setVerificationRequired(false)
            setVerificationToken(null)
            setError(null)
            setChallengeEpoch((value) => value + 1)
          }}>
            {t('auth.verificationTryNormal')}
          </button>
        )}
        <Button type="submit" disabled={formState.isSubmitting || (verificationRequired && !!sitekey && !verificationToken)}>
          {formState.isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </Button>
      </form>
      {import.meta.env.VITE_ACCOUNT_EMAIL_ENABLED === 'true' && (
        <Link to="/lozinka/zaboravljena" className="mt-4 text-center text-sm font-semibold text-brand-dark">
          {t('accountSecurity.forgotLink')}
        </Link>
      )}
      <p className="mt-6 text-center text-muted">
        {t('auth.noAccount')}{' '}
        <Link to="/registracija" className="font-semibold text-brand-dark">
          {t('auth.register')}
        </Link>
      </p>
    </AuthLayout>
  )
}
