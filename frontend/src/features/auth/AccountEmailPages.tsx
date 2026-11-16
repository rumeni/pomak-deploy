import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button, Field, FormError } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AuthLayout } from './AuthLayout'
import { resetPasswordAndClearSession } from './resetPassword'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await api.post('/auth/password/reset/request/', { email })
      setSent(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <AuthLayout title={t('accountSecurity.forgotTitle')}>
      {sent ? <p role="status" className="text-muted">{t('accountSecurity.resetSent')}</p> : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <p className="text-muted">{t('accountSecurity.forgotExplanation')}</p>
          <Field name="email" label={t('auth.email')} type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <FormError message={error} />
          <Button disabled={pending || !email.trim()}>{pending ? t('common.saving') : t('accountSecurity.sendReset')}</Button>
        </form>
      )}
      <Link to="/prijava" className="mt-6 text-center font-semibold text-brand-dark">{t('accountSecurity.backToLogin')}</Link>
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const [params] = useSearchParams()
  const uid = params.get('uid')
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!uid || !token || password !== confirm) {
      setError(t('accountSecurity.passwordsMismatch'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await resetPasswordAndClearSession(uid, token, password, logout)
      setDone(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <AuthLayout title={t('accountSecurity.resetTitle')}>
      {done ? <p role="status" className="text-muted">{t('accountSecurity.passwordResetDone')}</p> : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          {!uid || !token ? <FormError message={t('accountSecurity.invalidLink')} /> : null}
          <Field name="new_password" label={t('accountSecurity.newPassword')} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <Field name="repeat_password" label={t('accountSecurity.repeatPassword')} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          <FormError message={error} />
          <Button disabled={pending || !uid || !token || password.length < 8 || confirm.length < 8}>{pending ? t('common.saving') : t('accountSecurity.savePassword')}</Button>
        </form>
      )}
      <Link to="/prijava" className="mt-6 text-center font-semibold text-brand-dark">{t('accountSecurity.backToLogin')}</Link>
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const verify = async () => {
    if (!token) return
    setPending(true)
    setError(null)
    try {
      await api.post('/auth/email/verify/', { token })
      setDone(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <AuthLayout title={t('accountSecurity.verifyTitle')}>
      {done ? (
        <p role="status" className="text-muted">{t('accountSecurity.verifyDone')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-muted">{t('accountSecurity.verifyExplanation')}</p>
          {!token && <FormError message={t('accountSecurity.invalidLink')} />}
          <FormError message={error} />
          <Button disabled={!token || pending} onClick={() => void verify()}>{pending ? t('common.saving') : t('accountSecurity.verifyAction')}</Button>
        </div>
      )}
      <Link to="/prijava" className="mt-6 text-center font-semibold text-brand-dark">{t('accountSecurity.backToLogin')}</Link>
      {done && <button type="button" className="mt-3 font-semibold text-brand-dark" onClick={() => window.location.assign('/danas')}>{t('accountSecurity.continueApp')}</button>}
    </AuthLayout>
  )
}

export function EmailVerificationPendingPage() {
  const { t } = useTranslation()
  const { me, logout } = useAuth()
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resend = async () => {
    setPending(true)
    setError(null)
    try {
      await api.post('/auth/email/resend/', {})
      setSent(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <AuthLayout title={t('accountSecurity.verifyRequiredTitle')}>
      <p className="text-muted">{t('accountSecurity.verifyRequiredText', { email: me?.email ?? '' })}</p>
      {sent && <p className="mt-3 text-sm text-muted" role="status">{t('accountSecurity.resetSent')}</p>}
      <FormError message={error} />
      <div className="mt-5 flex flex-col gap-3">
        <Button disabled={pending} onClick={() => void resend()}>{pending ? t('common.saving') : t('accountSecurity.resendEmail')}</Button>
        <button type="button" className="min-h-12 font-semibold text-brand-dark" onClick={() => window.location.reload()}>{t('accountSecurity.refreshVerification')}</button>
        <button type="button" className="min-h-12 font-semibold text-muted" onClick={logout}>{t('profile.logout')}</button>
      </div>
    </AuthLayout>
  )
}
