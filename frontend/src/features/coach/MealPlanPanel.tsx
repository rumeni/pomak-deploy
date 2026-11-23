import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { formatDecimal } from '../../lib/format'
import { useDebounced } from '../../lib/useDebounced'
import { mealLabel, mealSettings } from '../diary/meals'
import type { MealKey } from '../diary/types'
import { useFoods, type Food } from '../nutrition/api'
import { isCollaborationChanged } from './access'
import { useClientGuard } from './guard'
import { useClientMealPlan, useSaveMealPlan } from './mealPlanApi'
import { fromServer, newPlanItem, type DraftItem } from './mealPlanDraft'

const PLAN_MEALS: MealKey[] = ['breakfast', 'lunch', 'dinner', 'snack']

/** The coach's daily meal plan for a client: meals with shared foods, logged by the client with one tap. */
export function MealPlanPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const plan = useClientMealPlan(clientId)
  const guard = useClientGuard(clientId, plan, {
    key: ['coach-client-meal-plan', clientId], redact: (d) => ({ ...d, items: [] }),
  })
  const save = useSaveMealPlan(clientId)
  const data = guard.state === 'ok' ? plan.data : undefined
  // The draft starts from what is saved and restarts whenever a newer plan arrives.
  const [draft, setDraft] = useState<{ from: string | null; items: DraftItem[] } | null>(null)
  const [adding, setAdding] = useState<MealKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (data && (!draft || draft.from !== data.updated_at) && !save.isPending) {
    setDraft({ from: data.updated_at, items: fromServer(data) })
  }
  const items = draft?.items ?? []
  const labels = mealSettings(null)
  const update = (next: DraftItem[]) => setDraft((d) => ({ from: d?.from ?? null, items: next }))

  const submit = () => {
    setError(null)
    if (items.some((item) => !(Number(item.grams.replace(',', '.')) > 0))) return setError(t('coachSpace.mealPlan.invalidAmount'))
    save.mutate({
      connection_id: data!.access.connection_id,
      items: items.map(({ meal, food_id, grams, portion_name }) => ({ meal, food_id, grams: grams.replace(',', '.'), portion_name })),
    })
  }

  return (
    <Card title={t('coachSpace.mealPlan.title')}>
      {(plan.isLoading || guard.state === 'stale') && <p className="text-muted">{t('common.loading')}</p>}
      {plan.isError && !data && <FormError message={t('errors.loadFailed')} />}
      {data && !data.allowed && <p className="text-sm text-muted">{t('coachSpace.mealPlan.notAllowed')}</p>}
      {data?.allowed && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('coachSpace.mealPlan.hint')}</p>
          {PLAN_MEALS.map((meal) => {
            const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => item.meal === meal)
            return (
              <section key={meal} className="rounded-xl bg-surface p-3 ring-1 ring-line">
                <h3 className="font-semibold">{mealLabel(meal, labels, t)}</h3>
                {!rows.length && <p className="text-sm text-muted">{t('coachSpace.mealPlan.emptyMeal')}</p>}
                <ul className="flex flex-col">
                  {rows.map(({ item, index }) => (
                    <li key={`${item.food_id}-${index}`} className="flex items-center gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <input
                        aria-label={t('coachSpace.mealPlan.grams', { name: item.name })}
                        inputMode="decimal"
                        value={item.grams}
                        onChange={(e) => update(items.map((x, i) => (i === index ? { ...x, grams: e.target.value, portion_name: '' } : x)))}
                        className="min-h-11 w-20 rounded-lg border border-line bg-card px-2 text-right tabular-nums"
                      />
                      <span className="text-sm text-muted">g</span>
                      <button
                        type="button"
                        aria-label={t('coachSpace.mealPlan.remove', { name: item.name })}
                        onClick={() => update(items.filter((_, i) => i !== index))}
                        className="flex size-11 items-center justify-center rounded-full text-muted active:bg-line"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                {adding === meal ? (
                  <FoodSearch
                    onPick={(food) => { update([...items, newPlanItem(meal, food)]); setAdding(null) }}
                    onCancel={() => setAdding(null)}
                  />
                ) : (
                  <button type="button" onClick={() => setAdding(meal)} className="mt-1 min-h-11 font-semibold text-brand-dark">
                    {t('coachSpace.mealPlan.addFood')}
                  </button>
                )}
              </section>
            )
          })}
          <FormError message={error ?? (isCollaborationChanged(save.error) ? t('coachSpace.collaborationChanged') : save.error ? errorMessage(save.error) : null)} />
          <Button onClick={submit} disabled={save.isPending}>{save.isPending ? t('common.saving') : t('coachSpace.mealPlan.save')}</Button>
          {save.isSuccess && <p role="status" className="text-sm text-brand-dark">{t('coachSpace.mealPlan.saved')}</p>}
        </div>
      )}
    </Card>
  )
}

/** Search in the shared database only: the client cannot see the coach's own foods. */
function FoodSearch({ onPick, onCancel }: { onPick: (food: Food) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const foods = useFoods(search)
  const shared = (foods.data ?? []).filter((food) => !food.is_custom).slice(0, 8)
  return (
    <div className="mt-2 flex flex-col gap-1">
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('nutrition.searchPlaceholder')}
        aria-label={t('nutrition.searchAria')}
        className="min-h-11 rounded-xl border border-line bg-card px-3"
      />
      {search && shared.map((food) => (
        <button key={food.id} type="button" onClick={() => onPick(food)} className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-left active:bg-brand-soft">
          <span className="min-w-0 truncate">{food.name}</span>
          <span className="shrink-0 text-sm text-muted tabular-nums">{formatDecimal(Number(food.kcal))} kcal/100 g</span>
        </button>
      ))}
      <button type="button" onClick={onCancel} className="min-h-11 self-start text-sm text-muted">{t('common.back')}</button>
    </div>
  )
}
