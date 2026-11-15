import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, Field, FormError, ScreenHeader } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { clearLocalData } from '../workout/localData'

/** Trajno brisanje naloga, uz lozinku. Pre toga predlaže izvoz podataka. */
export function DeleteAccountPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me, logout } = useAuth()
  const [password, setPassword] = useState('')

  const remove = useMutation({
    mutationFn: async () => api.post('/auth/me/delete/', { password }),
    onSuccess: async () => {
      if (me) await clearLocalData(me.id)
      logout()
    },
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!window.confirm(t('deleteAccount.confirm'))) return
    remove.mutate()
  }

  const items = ['workouts', 'diary', 'body', 'library', 'account'] as const
  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('deleteAccount.title')} onBack={() => navigate(-1)} />
      <form className="mx-auto flex max-w-xl flex-col gap-4 p-4" onSubmit={onSubmit} noValidate>
        <p>{t('deleteAccount.intro')}</p>
        <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-muted">
          {items.map((i) => (
            <li key={i}>{t(`deleteAccount.item_${i}`)}</li>
          ))}
        </ul>
        <p className="rounded-xl bg-brand-soft p-3 text-sm text-brand-dark">{t('deleteAccount.exportFirst')}</p>
        <Field
          label={t('deleteAccount.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={remove.isError ? errorMessage(remove.error) : null} />
        <Button type="submit" variant="danger" disabled={!password || remove.isPending}>
          {remove.isPending ? t('deleteAccount.deleting') : t('deleteAccount.submit')}
        </Button>
      </form>
    </div>
  )
}
