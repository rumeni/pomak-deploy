import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDecimal } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { useMyMealPlan } from '../coach/mealPlanApi'
import { planDrafts, planItemsFor, planSummary } from './mealPlan'
import { rememberFood, saveDrafts } from './store'
import type { MealKey } from './types'

/** The coach's plan for this meal, logged with one tap (works offline like a saved meal). */
export function CoachPlanRow({ date, meal, onNotice }: { date: string; meal: MealKey; onNotice: (message: string) => void }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const plan = useMyMealPlan(!!me && !me.profile.is_coach)
  const adding = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = planItemsFor(plan.data?.items, meal)
  if (!plan.data || !items.length) return null

  const add = async () => {
    // A second tap must not log the meal twice.
    if (!me || adding.current) return
    adding.current = true
    setPending(true)
    setError(null)
    try {
      await saveDrafts(me.id, planDrafts(items, date, meal, new Date(), uuid))
      await Promise.allSettled(items.filter((item) => item.food).map((item) => rememberFood(me.id, item.food!)))
      onNotice(t('diary.planLogged', { count: items.length }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      adding.current = false
      setPending(false)
    }
  }

  return (
    <div className="mx-4 mb-2 rounded-xl bg-surface p-3 ring-1 ring-line">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('diary.coachPlan', { name: plan.data.coach_name })}</p>
      <p className="mt-1 text-sm">{planSummary(items, (g) => formatDecimal(g))}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => void add()}
        className="mt-2 min-h-11 w-full rounded-xl bg-brand-soft font-semibold text-brand-dark active:bg-line disabled:opacity-50"
      >
        {t('diary.logFromPlan')}
      </button>
      <FormError message={error} />
    </div>
  )
}
