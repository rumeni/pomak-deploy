import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Card, EmptyState, ScreenHeader } from '../../components/ui'
import { formatDecimal, formatShortDate, toISODate } from '../../lib/format'
import { normalizeGoal, useTargets, type Target } from './api'
import { targetOn } from './target'
import { GoalGuidance } from './GoalGuidance'
import { TargetExplanation } from './TargetExplanation'

const linkClass = 'flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white active:bg-brand-dark'

/** Kalorijski cilj: trenutni (sa objašnjenjem), zakazani i raniji. */
export function TargetPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: targets, isLoading, isError } = useTargets()
  const today = toISODate(new Date())

  const current = targets ? targetOn(targets, today) : undefined
  const upcoming = targets?.filter((x) => x.valid_from > today).reverse() ?? []
  const past = targets?.filter((x) => x.valid_from < (current?.valid_from ?? today) && x !== current) ?? []

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('target.title')} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        {isLoading && <p className="py-4 text-center text-muted">{t('common.loading')}</p>}
        {isError && <p className="py-4 text-center text-danger">{t('target.loadFailed')}</p>}

        {targets && !current && (
          <EmptyState
            title={t('target.noneTitle')}
            text={t('target.noneText')}
            action={
              <Link to="/ishrana/cilj/novi" className={linkClass}>
                {t('target.setTarget')}
              </Link>
            }
          />
        )}

        {current && (
          <>
            <TargetCard target={current} title={t('target.current')} expanded />
            <Link to="/ishrana/cilj/novi" className={linkClass}>
              {t('target.newTarget')}
            </Link>
          </>
        )}

        {upcoming.map((x) => (
          <TargetCard key={x.valid_from} target={x} title={t('target.upcoming')} />
        ))}

        {past.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">{t('target.history')}</h2>
            {past.map((x) => (
              <TargetCard key={x.valid_from} target={x} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

function TargetCard({ target, title, expanded = false }: { target: Target; title?: string; expanded?: boolean }) {
  const { t } = useTranslation()
  const macros: [string, number | null][] = [
    [t('nutrition.proteinShort'), target.protein_g],
    [t('nutrition.carbsShort'), target.carbs_g],
    [t('nutrition.fatShort'), target.fat_g],
  ]
  return (
    <Card>
      {title && <p className="text-sm font-medium text-muted">{title}</p>}
      <p className="text-3xl font-bold tabular-nums">
        {formatDecimal(target.kcal)} <span className="text-base font-medium text-muted">{t('target.kcalPerDay')}</span>
      </p>
      <p className="mt-1 text-sm tabular-nums">
        {macros.map(([label, value]) => `${label} ${value === null ? '–' : `${formatDecimal(value)} g`}`).join(' · ')}
      </p>
      <p className="mt-2 text-sm text-muted">
        {t(`target.mode_${target.mode}`)} · {t('target.validFrom', { date: formatShortDate(target.valid_from) })}
      </p>
      {target.mode === 'coach' && (target.explanation as { coach_note?: string } | null)?.coach_note && (
        <p className="mt-1 text-sm">{t('target.coachNote')}: „{(target.explanation as { coach_note?: string } | null)?.coach_note}“</p>
      )}
      {target.mode !== 'coach' && target.inputs && target.explanation && (
        <details className="mt-3" open={expanded}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-dark">{t('target.howCalculated')}</summary>
          <TargetExplanation
            kcal={target.kcal}
            protein={target.protein_g}
            carbs={target.carbs_g}
            fat={target.fat_g}
            inputs={target.inputs}
            explanation={target.explanation}
          />
          <p className="mt-2 text-xs text-muted">{t('target.methodNote', { method: target.method })}</p>
        </details>
      )}
      {target.mode === 'app' && target.inputs && (
        <div className="mt-3"><GoalGuidance goal={normalizeGoal(target.inputs.goal)} /></div>
      )}
    </Card>
  )
}
