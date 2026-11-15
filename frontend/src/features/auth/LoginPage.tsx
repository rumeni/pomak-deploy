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

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const [error, setError] = useState<string | null>(null)

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
      await login(email, password)
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <AuthLayout title={t('auth.loginTitle')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label={t('auth.email')} type="email" autoComplete="email" inputMode="email" {...register('email')} error={formState.errors.email?.message} />
        <Field label={t('auth.password')} type="password" autoComplete="current-password" {...register('password')} error={formState.errors.password?.message} />
        <FormError message={error} />
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </Button>
      </form>
      <p className="mt-6 text-center text-muted">
        {t('auth.noAccount')}{' '}
        <Link to="/registracija" className="font-semibold text-brand-dark">
          {t('auth.register')}
        </Link>
      </p>
    </AuthLayout>
  )
}
