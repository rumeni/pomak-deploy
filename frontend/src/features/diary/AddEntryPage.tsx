import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { FormError, ScreenHeader } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { errorMessage } from '../../lib/api'
import { toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { useDebounced } from '../../lib/useDebounced'
import { useFoods, type Food } from '../nutrition/api'
import { MacroLine } from '../nutrition/MacroLine'
import { useDeleteSavedMeal, useSavedMeals, type SavedMeal } from './api'
import { mealLabel, mealSettings } from './meals'
import { entryFromSavedItem } from './model'
import { rememberFood, saveDrafts, useRecentFoods } from './store'
import { MEALS, type MealKey } from './types'

/** Izbor namirnice za obrok: nedavne (rade i bez interneta), pretraga baze ili ručni unos. */
export function AddEntryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useAuth()
  const [params] = useSearchParams()
  const date = params.get('datum') ?? toISODate(new Date())
  const meal = (MEALS.includes(params.get('obrok') as MealKey) ? params.get('obrok') : 'snack') as MealKey
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const results = useFoods(search)
  const recent = useRecentFoods(me?.id)
  const savedMeals = useSavedMeals()
  const deleteSaved = useDeleteSavedMeal()
  const label = mealLabel(meal, mealSettings(me?.profile.meals), t)

  const choose = async (food: Food) => {
    if (me) await rememberFood(me.id, food)
    navigate(`/ishrana/stavka?namirnica=${food.id}&datum=${date}&obrok=${meal}`, { replace: true })
  }

  // Ceo sačuvani obrok odjednom; namirnice daju svoje današnje vrednosti.
  const addSavedMeal = async (saved: SavedMeal) => {
    if (!me) return
    const now = new Date()
    const drafts = saved.items.flatMap((item) => entryFromSavedItem(item, uuid(), date, meal, now) ?? [])
    for (const item of saved.items) if (item.food) await rememberFood(me.id, item.food)
    await saveDrafts(me.id, drafts)
    navigate(`/ishrana?datum=${date}`, { replace: true })
  }

  const onDeleteSaved = (saved: SavedMeal) => {
    if (window.confirm(t('diary.deleteSavedMealConfirm', { name: saved.name }))) deleteSaved.mutate(saved.id)
  }

  const list = search ? results.data : recent
  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('diary.addTitle', { meal: label })} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('nutrition.searchPlaceholder')}
          aria-label={t('nutrition.searchAria')}
          className="min-h-12 w-full rounded-xl border border-line bg-card px-4 text-base outline-none focus:border-brand"
        />
        <Link
          to={`/ishrana/rucni?datum=${date}&obrok=${meal}`}
          replace
          className="flex min-h-12 items-center justify-center rounded-xl bg-brand-soft font-semibold text-brand-dark"
        >
          {t('diary.manual')}
        </Link>

        {!search && !!savedMeals.data?.length && (
          <>
            <h2 className="mt-2 text-lg font-semibold">{t('diary.savedMeals')}</h2>
            <ul className="flex flex-col rounded-2xl bg-card shadow-sm ring-1 ring-line/60">
              {savedMeals.data.map((saved) => (
                <li key={saved.id} className="flex items-center border-b border-line last:border-0">
                  <button type="button" onClick={() => void addSavedMeal(saved)} className="flex min-h-16 flex-1 flex-col justify-center px-4 py-2 text-left active:bg-brand-soft">
                    <span className="font-medium">{saved.name}</span>
                    <span className="line-clamp-1 text-sm text-muted">
                      {t('diary.items', { count: saved.items.length })} · {saved.items.map((i) => i.food?.name ?? i.name).join(', ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('diary.deleteSavedMeal')}
                    onClick={() => onDeleteSaved(saved)}
                    className="flex size-12 shrink-0 items-center justify-center text-muted active:bg-line"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!search && <FormError message={deleteSaved.error ? errorMessage(deleteSaved.error) : null} />}
        {!search && savedMeals.isError && <p className="text-sm text-muted">{t('diary.savedMealsOffline')}</p>}

        {!search && <h2 className="mt-2 text-lg font-semibold">{t('diary.recent')}</h2>}
        {!search && recent?.length === 0 && <p className="text-muted">{t('diary.noRecent')}</p>}
        {search && results.isError && <p className="text-sm text-muted">{t('diary.offlineSearch')}</p>}
        {search && results.data?.length === 0 && <p className="text-muted">{t('nutrition.noResults', { q: search })}</p>}

        {!!list?.length && (
          <ul className="flex flex-col rounded-2xl bg-card shadow-sm ring-1 ring-line/60">
            {list.map((food) => (
              <li key={food.id} className="border-b border-line last:border-0">
                <button type="button" onClick={() => void choose(food)} className="flex min-h-16 w-full flex-col justify-center px-4 py-2 text-left active:bg-brand-soft">
                  <span className="font-medium">{food.name}</span>
                  <span className="text-sm text-muted">
                    {Math.round(Number(food.kcal))} {t('nutrition.kcal')} · <MacroLine protein={food.protein_g} carbs={food.carbs_g} fat={food.fat_g} /> ·{' '}
                    {t('nutrition.per100')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
