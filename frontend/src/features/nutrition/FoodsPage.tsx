import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { ScreenHeader } from '../../components/ui'
import { useDebounced } from '../../lib/useDebounced'
import { useFoods, type Food } from './api'
import { MacroLine } from './MacroLine'

/** Baza namirnica: pretraga, detalj i lične namirnice. */
export function FoodsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const { data: foods, isLoading, isError } = useFoods(search)

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('diary.foodsDb')} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <div className="flex items-center justify-end gap-1">
          <Link to="/ishrana/recepti/novi" className="flex min-h-11 items-center rounded-xl px-3 font-semibold text-brand-dark active:bg-brand-soft">
            {t('nutrition.newRecipe')}
          </Link>
          <Link to="/ishrana/namirnice/nova" className="flex min-h-11 items-center rounded-xl px-3 font-semibold text-brand-dark active:bg-brand-soft">
            {t('nutrition.newFood')}
          </Link>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('nutrition.searchPlaceholder')}
          aria-label={t('nutrition.searchAria')}
          className="min-h-12 w-full rounded-xl border border-line bg-card px-4 text-base outline-none focus:border-brand"
        />

        {isLoading && <p className="py-4 text-center text-muted">{t('common.loading')}</p>}
        {isError && <p className="py-4 text-center text-danger">{t('nutrition.loadFailed')}</p>}
        {foods?.length === 0 && <p className="py-4 text-center text-muted">{t('nutrition.noResults', { q: search })}</p>}
        {!!foods?.length && (
          <ul className="flex flex-col rounded-2xl bg-card shadow-sm ring-1 ring-line/60">
            {foods.map((food) => (
              <FoodRow key={food.id} food={food} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function FoodRow({ food }: { food: Food }) {
  const { t } = useTranslation()
  return (
    <li className="border-b border-line last:border-0">
      <Link to={`/ishrana/namirnice/${food.id}`} className="flex min-h-16 flex-col justify-center px-4 py-2 active:bg-brand-soft">
        <span className="font-medium">
          {food.name}
          {food.is_custom && (
            <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">
              {food.source === 'recipe' ? t('nutrition.recipeBadge') : t('nutrition.myFood')}
            </span>
          )}
        </span>
        <span className="text-sm text-muted">
          {Math.round(Number(food.kcal))} {t('nutrition.kcal')} · <MacroLine protein={food.protein_g} carbs={food.carbs_g} fat={food.fat_g} /> ·{' '}
          {t('nutrition.per100')}
        </span>
      </Link>
    </li>
  )
}
