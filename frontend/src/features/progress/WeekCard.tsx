import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Card } from '../../components/ui'
import { addDays, formatDecimal, fromISODate, getFormatLocale, toISODate } from '../../lib/format'
import { useWeek, type WeekOverview } from './api'
import { mondayOf } from './week'

const MACROS = ['protein_g', 'carbs_g', 'fat_g'] as const

/** Nedeljni pregled: treninzi, ishrana (prosek samo iz kompletnih dana, uz obuhvat) i težina. */
export function WeekCard() {
  const { t } = useTranslation()
  const thisWeek = mondayOf(toISODate(new Date()))
  const [start, setStart] = useState(thisWeek)
  const { data, isLoading, isError } = useWeek(start)
  const end = addDays(start, 6)
  const fmt = new Intl.DateTimeFormat(getFormatLocale(), { day: 'numeric', month: 'numeric' })
  const title = start === thisWeek ? t('progress.thisWeek') : `${fmt.format(fromISODate(start))} – ${fmt.format(fromISODate(end))}`

  return (
    <Card>
      <div className="-mx-2 -mt-2 flex items-center justify-between">
        <NavButton label={t('progress.prevWeek')} onClick={() => setStart(addDays(start, -7))} d="M15 18l-6-6 6-6" />
        <h2 className="font-semibold">{title}</h2>
        <NavButton label={t('progress.nextWeek')} onClick={() => setStart(addDays(start, 7))} d="M9 18l6-6-6-6" disabled={start >= thisWeek} />
      </div>
      {isLoading && <p className="py-4 text-center text-muted">{t('common.loading')}</p>}
      {isError && <p className="py-4 text-center text-danger">{t('progress.loadFailed')}</p>}
      {data && <WeekBody week={data} />}
    </Card>
  )
}

function NavButton({ label, onClick, d, disabled }: { label: string; onClick: () => void; d: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-11 items-center justify-center rounded-full active:bg-line disabled:opacity-30"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  )
}

function WeekBody({ week }: { week: WeekOverview }) {
  const { t } = useTranslation()
  const n = week.nutrition
  const weekday = new Intl.DateTimeFormat(getFormatLocale(), { weekday: 'narrow' })
  const w = week.weight

  return (
    <dl className="mt-2 flex flex-col gap-3">
      <div>
        <dt className="text-sm text-muted">{t('progress.workouts')}</dt>
        <dd className="text-lg font-semibold tabular-nums">
          {week.workouts.target ? t('progress.workoutsOfTarget', { count: week.workouts.count, target: week.workouts.target }) : week.workouts.count}
        </dd>
      </div>

      <div>
        <dt className="text-sm text-muted">{t('progress.nutrition')}</dt>
        <dd>
          <ol className="my-1 flex gap-1.5" aria-label={t('progress.daysCompleteAria', { count: n.complete_days })}>
            {n.days.map((d) => (
              <li key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={`size-3.5 rounded-full ${
                    d.status === 'complete' ? 'bg-brand' : d.entries > 0 ? 'bg-brand/30 ring-1 ring-brand/50' : 'ring-1 ring-line'
                  }`}
                  aria-hidden
                />
                <span className="text-xs text-muted">{weekday.format(fromISODate(d.date))}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">{t('progress.completeDays', { count: n.complete_days })}</p>
          {n.avg_kcal === null ? (
            <p className="mt-1 text-sm">{t('progress.noCompleteDays')}</p>
          ) : (
            <>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {t('progress.avgKcal', { kcal: formatDecimal(Number(n.avg_kcal)) })}
                {n.avg_target_kcal && (
                  <span className="text-sm font-normal text-muted"> · {t('progress.avgTarget', { kcal: formatDecimal(Number(n.avg_target_kcal)) })}</span>
                )}
              </p>
              <p className="text-sm tabular-nums text-muted">
                {MACROS.map((m) => {
                  const avg = n[`avg_${m}`]
                  const unknown = n[`${m}_unknown`]
                  const short = t(`nutrition.${m === 'protein_g' ? 'protein' : m === 'carbs_g' ? 'carbs' : 'fat'}Short`)
                  return `${short} ${avg === null ? '?' : formatDecimal(Number(avg))} g${unknown ? '*' : ''}`
                }).join(' · ')}
              </p>
              {MACROS.some((m) => n[`${m}_unknown`] > 0) && <p className="text-xs text-muted">{t('progress.unknownMacrosNote')}</p>}
            </>
          )}
        </dd>
      </div>

      <div>
        <dt className="text-sm text-muted">{t('progress.bodyWeight')}</dt>
        <dd className="tabular-nums">
          {w ? (
            <>
              <span className="text-lg font-semibold">{formatDecimal(Number(w.latest))} kg</span>
              {w.change !== null && w.previous_date && (
                <span className="text-sm text-muted">
                  {' '}
                  · {t('progress.weightChange', { change: `${Number(w.change) > 0 ? '+' : Number(w.change) < 0 ? '−' : '±'}${formatDecimal(Math.abs(Number(w.change)))}` })}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted">{t('progress.noWeightThisWeek')}</span>
          )}
        </dd>
      </div>
    </dl>
  )
}
