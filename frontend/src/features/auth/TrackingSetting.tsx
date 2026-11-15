import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FormError, Segmented } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Me } from '../../lib/types'

type Tracking = 'both' | 'training' | 'nutrition'

/** Šta korisnik prati (isto kao na početku); menja sadržaj ekrana Danas. Podaci se ne brišu. */
export function TrackingSetting() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  if (!me) return null
  const p = me.profile
  const value: Tracking = p.tracks_training && p.tracks_nutrition ? 'both' : p.tracks_training ? 'training' : 'nutrition'

  const onChange = async (next: Tracking) => {
    setError(null)
    try {
      const { data } = await api.patch<Me>('/auth/me/', {
        profile: { tracks_training: next !== 'nutrition', tracks_nutrition: next !== 'training' },
      })
      queryClient.setQueryData(['me'], data)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <>
      <Segmented
        legend={t('profile.tracking')}
        options={[
          { value: 'both', label: t('profile.trackBoth') },
          { value: 'training', label: t('profile.trackTraining') },
          { value: 'nutrition', label: t('profile.trackNutrition') },
        ]}
        value={value}
        onChange={(v) => void onChange(v)}
      />
      <FormError message={error} />
    </>
  )
}
