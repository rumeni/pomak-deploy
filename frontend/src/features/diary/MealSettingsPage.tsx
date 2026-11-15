import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, FormError, ScreenHeader } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Me } from '../../lib/types'
import { mealSettings } from './meals'
import type { MealSetting } from './types'

/** Koje obroke korisnik koristi i kako se zovu (važi na svim uređajima, čuva se na nalogu). */
export function MealSettingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const [meals, setMeals] = useState<MealSetting[]>(() => mealSettings(me?.profile.meals))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (list: MealSetting[]) => (await api.patch<Me>('/auth/me/', { profile: { meals: list } })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      navigate(-1)
    },
  })

  const update = (key: MealSetting['key'], patch: Partial<MealSetting>) =>
    setMeals((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)))

  const onSave = () => {
    setError(null)
    if (!meals.some((m) => m.enabled)) return setError(t('mealSettings.atLeastOne'))
    save.mutate(meals.map((m) => ({ ...m, name: m.name.trim() })))
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('mealSettings.title')} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <p className="text-sm text-muted">{t('mealSettings.hint')}</p>
        <ul className="flex flex-col rounded-2xl bg-card shadow-sm ring-1 ring-line/60">
          {meals.map((m) => (
            <li key={m.key} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={(e) => update(m.key, { enabled: e.target.checked })}
                aria-label={`${t('mealSettings.enabled')}: ${m.name || t(`diary.meal_${m.key}`)}`}
                className="size-6 shrink-0 accent-brand"
              />
              <input
                value={m.name}
                onChange={(e) => update(m.key, { name: e.target.value })}
                placeholder={t(`diary.meal_${m.key}`)}
                aria-label={t('mealSettings.name')}
                maxLength={40}
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand focus:bg-card"
              />
            </li>
          ))}
        </ul>
        <FormError message={error ?? (save.isError ? errorMessage(save.error) : null)} />
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('mealSettings.save')}
        </Button>
      </div>
    </div>
  )
}
