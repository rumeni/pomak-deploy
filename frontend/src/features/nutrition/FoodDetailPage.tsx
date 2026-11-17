import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDecimal, parseDecimal, toISODate } from '../../lib/format'
import { mealForTime, mealSettings } from '../diary/meals'
import { AmountPicker } from './AmountPicker'
import { useDeleteFood, useReportFood, useFood } from './api'
import { fmtValue } from './macroFormat'
import { nutritionFor } from './nutrition'

export function FoodDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: food, isLoading, isError } = useFood(id)
  const report = useReportFood()
  const remove = useDeleteFood()
  const { me } = useAuth()
  const [amount, setAmount] = useState('100')

  const back = () => navigate('/ishrana')
  if (isLoading) return <LoadingScreen />
  if (isError || !food) {
    return (
      <>
        <ScreenHeader title={t('nutrition.foodsTitle')} onBack={back} />
        <p className="p-6 text-center text-danger">{t('nutrition.notFound')}</p>
      </>
    )
  }

  const grams = parseDecimal(amount)
  const values = nutritionFor(food, grams ?? 0)
  const hasUnknown = [food.protein_g, food.carbs_g, food.fat_g, food.fiber_g].some((v) => v === null)
  const rows: [string, number | null, string][] = [
    [t('nutrition.protein'), values.protein, 'g'],
    [t('nutrition.carbs'), values.carbs, 'g'],
    [t('nutrition.fat'), values.fat, 'g'],
    [t('nutrition.fiber'), values.fiber, 'g'],
  ]

  const isRecipe = food.source === 'recipe'
  const isCommunity = food.source === 'community'
  const sourceText =
    food.source === 'usda' ? t('nutrition.sourceUsda', { id: food.source_ref })
      : isRecipe ? t('nutrition.sourceRecipe')
        : isCommunity ? t(food.verified ? 'nutrition.sourceCommunityVerified' : 'nutrition.sourceCommunity')
          : t('nutrition.sourceCustom')
  const canEdit = food.can_edit ?? (food.is_custom && food.source === 'custom')

  const onReport = () => {
    const reason = window.prompt(t('nutrition.reportPrompt'))?.trim()
    if (!reason) return
    report.mutate({ id: food.id, reason }, { onSuccess: () => window.alert(t('nutrition.reportThanks')) })
  }

  const onDelete = () => {
    if (!window.confirm(t(isRecipe ? 'recipe.deleteConfirm' : 'nutrition.deleteConfirm', { name: food.name }))) return
    remove.mutate(food.id, { onSuccess: back })
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={food.name} onBack={back} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        {!isRecipe && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {t(`nutrition.state_${food.state}`)}
            {isCommunity && !food.verified && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-ink">{t('nutrition.unverified')}</span>
            )}
            {food.barcode && <span className="tabular-nums">· {food.barcode}</span>}
          </p>
        )}

        <AmountPicker value={amount} portions={food.portions} onChange={(grams) => setAmount(grams)} />

        <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60">
          <p className="text-sm font-medium text-muted">{t('nutrition.forAmount', { grams: grams === null ? '–' : formatDecimal(grams) })}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {grams === null ? '–' : values.kcal} <span className="text-base font-medium text-muted">{t('nutrition.kcal')}</span>
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
            {rows.map(([label, value, unit]) => (
              <div key={label} className="flex justify-between border-b border-line py-1.5">
                <dt className="text-muted">{label}</dt>
                <dd className="font-semibold tabular-nums">
                  {grams === null ? '–' : fmtValue(value)} {value !== null && grams !== null && unit}
                </dd>
              </div>
            ))}
          </dl>
          {hasUnknown && <p className="mt-3 text-xs text-muted">{t('nutrition.unknownHint')}</p>}
        </section>

        <Link
          to={`/ishrana/stavka?namirnica=${food.id}&datum=${toISODate(new Date())}&obrok=${mealForTime(mealSettings(me?.profile.meals), new Date())}`}
          className="flex min-h-12 items-center justify-center rounded-xl bg-brand font-semibold text-white active:bg-brand-dark"
        >
          {t('nutrition.addToDiary')}
        </Link>

        <p className="text-xs text-muted">
          {t('nutrition.source')}: {sourceText}
        </p>
        {isCommunity && !canEdit && (
          <Button variant="ghost" className="text-sm" onClick={onReport} disabled={report.isPending}>
            {t('nutrition.report')}
          </Button>
        )}
        {isCommunity && canEdit && (
          <Link
            to={`/ishrana/namirnice/${food.id}/izmena`}
            className="flex min-h-12 items-center justify-center rounded-xl bg-card font-semibold text-brand-dark ring-1 ring-line active:bg-brand-soft"
          >
            {t('nutrition.editFood')}
          </Link>
        )}

        {isRecipe && (
          <Link
            to={`/ishrana/recepti/${food.id}`}
            className="flex min-h-12 items-center justify-center rounded-xl bg-card font-semibold text-brand-dark ring-1 ring-line active:bg-brand-soft"
          >
            {t('nutrition.editRecipe')}
          </Link>
        )}

        {food.is_custom && (
          <>
            {food.source === 'custom' && (
              <Link
                to={`/ishrana/namirnice/${food.id}/izmena`}
                className="flex min-h-12 items-center justify-center rounded-xl bg-card font-semibold text-brand-dark ring-1 ring-line active:bg-brand-soft"
              >
                {t('nutrition.editFood')}
              </Link>
            )}
            <FormError message={remove.isError ? errorMessage(remove.error) : null} />
            <Button variant="ghost" className="text-danger" onClick={onDelete} disabled={remove.isPending}>
              {isRecipe ? t('recipe.delete') : t('nutrition.deleteFood')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

