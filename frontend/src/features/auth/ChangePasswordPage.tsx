import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, Field, FormError, ScreenHeader } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'

export function ChangePasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError(t('accountSecurity.passwordsMismatch'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await api.post('/auth/password/change/', {
        old_password: oldPassword,
        new_password: newPassword,
      })
      // All old sessions are revoked, including this one. Clear local Keystore
      // state and redirect to login; never persist the password.
      logout()
      navigate('/prijava', { replace: true })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('accountSecurity.changeTitle')} onBack={() => navigate('/profil')} />
      <form className="mx-auto flex max-w-xl flex-col gap-4 p-4" onSubmit={(event) => void submit(event)}>
        <Field name="old_password" type="password" autoComplete="current-password" label={t('accountSecurity.oldPassword')} value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
        <Field name="new_password" type="password" autoComplete="new-password" label={t('accountSecurity.newPassword')} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <Field name="confirm_password" type="password" autoComplete="new-password" label={t('accountSecurity.repeatPassword')} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        <p className="text-sm text-muted">{t('accountSecurity.changeWarning')}</p>
        <FormError message={error} />
        <Button disabled={pending || oldPassword.length === 0 || newPassword.length < 8 || confirmPassword.length < 8}>{pending ? t('common.saving') : t('accountSecurity.savePassword')}</Button>
      </form>
    </div>
  )
}
