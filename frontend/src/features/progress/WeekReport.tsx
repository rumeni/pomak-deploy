import { useTranslation } from 'react-i18next'

import { Card } from '../../components/ui'
import { formatDecimal } from '../../lib/format'
import type { WeekCheckIn, WeekReview } from './weekApi'
import { CHECKIN_SCALES } from './weeks'

function Tile({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <div className="app-card !p-3">
      <span className="block text-2xl font-extrabold tabular-nums">{value}</span>
      <span className="block text-xs text-muted">{label}</span>
      {detail && <span className="mt-0.5 block text-xs text-muted">{detail}</span>}
    </div>
  )
}

/** The week's facts. Parts the client does not share show as "not shared" for a coach. */
export function WeekReport({ review, forCoach = false }: { review: WeekReview; forCoach?: boolean }) {
  const { t } = useTranslation()
  const notShared = t('coach.notSharedShort')
  const w = review.workouts
  const weight = review.weight
  const nutrition = review.nutrition
  return (
    <section className="grid grid-cols-2 gap-2" aria-label={t('week.factsTitle')}>
      <Tile
        value={w.target ? `${w.count}/${w.target}` : String(w.count)}
        label={t('week.workouts')}
        detail={review.plan ? t('week.planned', { count: review.plan.planned }) : undefined}
      />
      <Tile
        value={`${formatDecimal(Number(review.training.volume_kg))} kg`}
        label={t('week.volume')}
        detail={`${t('week.sets', { count: review.training.working_sets })}${review.training.avg_rpe ? ` · RPE ${formatDecimal(Number(review.training.avg_rpe))}` : ''}`}
      />
      <Tile
        value={weight ? `${formatDecimal(Number(weight.latest))} kg` : '–'}
        label={t('week.weight')}
        detail={!review.shared.measurements && forCoach ? notShared
          : weight?.change != null ? t('week.change', { value: `${Number(weight.change) > 0 ? '+' : ''}${formatDecimal(Number(weight.change))}` }) : undefined}
      />
      <Tile
        value={nutrition?.avg_kcal ? `${formatDecimal(Number(nutrition.avg_kcal))}` : '–'}
        label={t('week.avgKcal')}
        detail={!review.shared.nutrition && forCoach ? notShared
          : nutrition ? t('week.completeDays', { count: nutrition.complete_days }) + (nutrition.avg_target_kcal ? ` · ${t('week.target', { value: formatDecimal(Number(nutrition.avg_target_kcal)) })}` : '') : undefined}
      />
      <Tile
        value={review.readiness ? `${review.readiness.avg_score}%` : '–'}
        label={t('week.readiness')}
        detail={!review.shared.readiness && forCoach ? notShared : review.readiness ? t('week.checkins', { count: review.readiness.checkins }) : undefined}
      />
    </section>
  )
}

/** The check-in as answered (read-only, e.g. for the coach). */
export function CheckInAnswers({ checkIn }: { checkIn: WeekCheckIn | null }) {
  const { t } = useTranslation()
  if (!checkIn) return <Card title={t('week.checkInTitle')}><p className="text-muted">{t('week.noCheckIn')}</p></Card>
  return (
    <Card title={t('week.checkInTitle')}>
      <ul className="flex flex-col gap-1 text-sm">
        {CHECKIN_SCALES.filter((f) => checkIn[f] != null).map((f) => (
          <li key={f}><span className="text-muted">{t(`week.q.${f}`)}:</span> <strong>{checkIn[f]}/5</strong></li>
        ))}
      </ul>
      {checkIn.hardest && <p className="mt-2 text-sm"><span className="text-muted">{t('week.q.hardest')}:</span> „{checkIn.hardest}“</p>}
      {checkIn.notes && <p className="mt-1 whitespace-pre-wrap text-sm"><span className="text-muted">{t('week.q.notes')}:</span> „{checkIn.notes}“</p>}
    </Card>
  )
}
