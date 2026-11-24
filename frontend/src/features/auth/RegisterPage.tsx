import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import { Button, ChoiceCards, Field, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AuthLayout } from './AuthLayout'
import { PasswordField } from './PasswordField'

export function RegisterPage() {
  const { t } = useTranslation()
  const { register: registerUser } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const schema = useMemo(
    () =>
      z.object({
        accountType: z.enum(['client', 'coach']),
        displayName: z.string().trim().max(80),
        email: z.email(t('auth.invalidEmail')),
        password: z.string().min(8, t('auth.passwordTooShort')),
      }),
    [t],
  )
  const { register, control, handleSubmit, formState } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { accountType: 'client', displayName: '' },
  })

  const accountTypes = [
    { value: 'client' as const, title: t('auth.accountClient'), text: t('auth.accountClientText') },
    { value: 'coach' as const, title: t('auth.accountCoach'), text: t('auth.accountCoachText') },
  ]

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      await registerUser(values)
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <AuthLayout title={t('auth.registerTitle')} compact>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Controller
          name="accountType"
          control={control}
          render={({ field }) => (
            <ChoiceCards name="accountType" legend={t('auth.howYouUse')} options={accountTypes} value={field.value} onChange={field.onChange} />
          )}
        />
        <Field label={t('auth.nameOptional')} autoComplete="given-name" {...register('displayName')} error={formState.errors.displayName?.message} />
        <Field label={t('auth.email')} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" {...register('email')} error={formState.errors.email?.message} />
        <PasswordField label={t('auth.password')} autoComplete="new-password" enterKeyHint="go" {...register('password')} error={formState.errors.password?.message} />
        <FormError message={error} />
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t('auth.registering') : t('auth.register')}
        </Button>
      </form>
      <p className="mt-6 text-center text-muted">
        {t('auth.haveAccount')}{' '}
        <Link to="/prijava" className="font-semibold text-brand-dark">
          {t('auth.login')}
        </Link>
      </p>
    </AuthLayout>
  )
}
