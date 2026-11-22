import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { formatDecimal } from '../../lib/format'
import { applyOwnProfileResponse, patchOwnProfile, profileScope } from '../../lib/profileMutation'
import type { BmiResult } from './bmi'

/** BMI as a number; the category (e.g. "Overweight") only after the user turns it on, saved on the account. */
export function BmiPanel({ bmi, ownerId, showCategory }: { bmi: BmiResult; ownerId: string; showCategory: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    setError(null)
    setSaving(true)
    try {
      const submitted = { show_bmi_category: !showCategory }
      const scope = profileScope(ownerId)
      const data = await patchOwnProfile(ownerId, submitted, scope)
      if (data) applyOwnProfileResponse(queryClient, scope, data, submitted)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-surface p-3" aria-label={t('progress.bmiLabel')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold tabular-nums">
          {t('progress.bmiLabel')}: {formatDecimal(bmi.value)}
          {showCategory && <> · {t(`progress.bmiCategory_${bmi.category}`)}</>}
        </p>
        <button
          type="button"
          className="-my-2 min-h-11 text-sm font-semibold text-brand-dark disabled:opacity-50"
          aria-pressed={showCategory}
          disabled={saving}
          onClick={() => void toggle()}
        >
          {showCategory ? t('progress.bmiHideCategory') : t('progress.bmiShowCategory')}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{t('progress.bmiNote')}</p>
      <FormError message={error} />
    </div>
  )
}
