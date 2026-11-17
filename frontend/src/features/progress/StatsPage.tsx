import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { BarChart } from '../../components/BarChart'
import { LineChart } from '../../components/LineChart'
import { Card, LoadingScreen, ScreenHeader } from '../../components/ui'
import { formatDecimal, getFormatLocale } from '../../lib/format'
import { formatRpe, LEVEL_SET, readinessBand, readinessScore, SCALE_FIELDS, sleepLabel, type ScaleField } from '../workout/rpe'
import { useStats } from './api'
import {
  answerCount,
  average,
  change,
  MIN_COMPARE,
  readinessComparison,
  readinessSeries,
  STATS_PERIODS,
  type PeriodTotals,
  type StatsPeriod,
  type TrainingStats,
} from './stats'

const PERIOD_KEY = 'pomak.statsPeriod'

function savedPeriod(): StatsPeriod {
  try {
    const value = localStorage.getItem(PERIOD_KEY)
    return (STATS_PERIODS as string[]).includes(value ?? '') ? (value as StatsPeriod) : '30'
  } catch {
    return '30'
  }
}

const whole = (n: number) => new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 0 }).format(n)
const shortDay = (iso: string) =>
  new Intl.DateTimeFormat(getFormatLocale(), { day: 'numeric', month: 'numeric' }).format(new Date(`${iso}T12:00:00`))
const longDay = (iso: string) =>
  new Intl.DateTimeFormat(getFormatLocale(), { day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`))

/** Training statistics and readiness history for a chosen period. */
export function StatsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<StatsPeriod>(savedPeriod)
  const { data, isLoading, isError } = useStats(period)

  const choose = (p: StatsPeriod) => {
    setPeriod(p)
    try {
      localStorage.setItem(PERIOD_KEY, p)
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={t('stats.title')} onBack={() => navigate('/napredak')} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <div className="flex gap-1.5" role="group" aria-label={t('stats.period')}>
          {STATS_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => choose(p)}
              className={`min-h-11 flex-1 rounded-xl text-sm font-semibold ${period === p ? 'bg-brand text-white' : 'bg-card ring-1 ring-line'}`}
            >
              {t(`stats.period_${p}`)}
            </button>
          ))}
        </div>

        {isLoading && <LoadingScreen />}
        {isError && <p className="py-6 text-center text-danger">{t('progress.loadFailed')}</p>}
        {data && (data.totals.sessions === 0 ? (
          <Card><p className="text-muted">{t('stats.empty')}</p></Card>
        ) : (
          <>
            <Totals data={data} />
            <Weekly data={data} />
            <Muscles data={data} />
            <TopLifts data={data} />
          </>
        ))}
        {data && <ReadinessSection data={data} />}
        {data && <HowItIsCounted />}
      </div>
    </div>
  )
}

function Totals({ data }: { data: TrainingStats }) {
  const { t } = useTranslation()
  const { totals, previous } = data
  const tile = (label: string, value: string, key: keyof PeriodTotals, unit = '') => {
    const delta = change(Number(totals[key] ?? 0), previous ? Number(previous[key] ?? 0) : null)
    return (
      <div className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="dashboard-metric text-3xl">{value}{unit && <span className="text-base font-medium text-muted"> {unit}</span>}</dd>
        {delta && (
          <dd className="text-xs text-muted tabular-nums">
            {delta.diff === 0 ? t('stats.same') : t('stats.vsPrevious', {
              change: `${delta.diff > 0 ? '+' : '−'}${key === 'volume_kg' ? whole(Math.abs(delta.diff)) : Math.abs(delta.diff)}${delta.pct !== null ? ` (${delta.pct > 0 ? '+' : ''}${delta.pct}%)` : ''}`,
            })}
          </dd>
        )}
      </div>
    )
  }
  return (
    <section aria-labelledby="stats-totals">
      <h2 id="stats-totals" className="sr-only">{t('stats.totals')}</h2>
      <dl className="grid grid-cols-2 gap-2">
        {tile(t('stats.sessions'), String(totals.sessions), 'sessions')}
        {tile(t('stats.workingSets'), String(totals.working_sets), 'working_sets')}
        {tile(t('stats.volume'), whole(Number(totals.volume_kg)), 'volume_kg', 'kg')}
        <div className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
          <dt className="text-xs text-muted">{t('stats.avgRpe')}</dt>
          <dd className="dashboard-metric text-3xl">{totals.avg_rpe ? formatRpe(Number(totals.avg_rpe)) : '–'}</dd>
          <dd className="text-xs text-muted">{t('stats.rpeSets', { count: totals.rpe_sets })}</dd>
        </div>
      </dl>
      {previous && <p className="mt-1 text-xs text-muted">{t(`stats.previous_${data.period}`)}</p>}
    </section>
  )
}

function Weekly({ data }: { data: TrainingStats }) {
  const { t } = useTranslation()
  const [measure, setMeasure] = useState<'volume' | 'sets'>('volume')
  const bars = data.weeks.map((w) => ({
    key: w.week_start,
    label: shortDay(w.week_start),
    title: t('stats.weekOf', { date: shortDay(w.week_start) }),
    value: measure === 'volume' ? Number(w.volume_kg) : w.working_sets,
  }))
  const format = (v: number) => (measure === 'volume' ? `${whole(v)} kg` : t('stats.setsCount', { count: v }))
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('stats.byWeek')}</h2>
        <div className="flex rounded-lg bg-surface p-0.5 text-xs font-semibold" role="group" aria-label={t('stats.byWeek')}>
          {(['volume', 'sets'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={measure === m}
              onClick={() => setMeasure(m)}
              className={`min-h-9 rounded-md px-3 ${measure === m ? 'bg-card shadow-sm' : 'text-muted'}`}
            >
              {t(`stats.measure_${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <BarChart bars={bars} format={format} label={`${t('stats.byWeek')}: ${t(`stats.measure_${measure}`)}`} />
      </div>
    </Card>
  )
}

function Muscles({ data }: { data: TrainingStats }) {
  const { t } = useTranslation()
  if (!data.muscles.length) return null
  const max = Math.max(...data.muscles.map((m) => m.working_sets))
  const weeks = data.weeks.length || 1
  return (
    <Card>
      <h2 className="font-semibold">{t('stats.byMuscle')}</h2>
      <p className="text-xs text-muted">{t('stats.byMuscleHint')}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {data.muscles.map((m) => (
          <li key={m.muscle} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
            <span className="truncate">{t(`muscle.${m.muscle}`)}</span>
            <span className="h-3 overflow-hidden rounded-full bg-surface">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${(m.working_sets / max) * 100}%` }} />
            </span>
            <span className="tabular-nums">
              <span className="font-semibold">{m.working_sets}</span>
              <span className="text-xs text-muted"> · {formatDecimal(Math.round((m.working_sets / weeks) * 10) / 10)}/{t('stats.perWeek')}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function TopLifts({ data }: { data: TrainingStats }) {
  const { t } = useTranslation()
  if (!data.top_lifts.length) return null
  return (
    <Card>
      <h2 className="font-semibold">{t('stats.topLifts')}</h2>
      <ul className="mt-2 flex flex-col">
        {data.top_lifts.map((lift) => (
          <li key={lift.exercise_id} className="border-b border-line last:border-0">
            <Link to={`/napredak/vezba/${lift.exercise_id}`} className="flex min-h-14 items-center gap-3 py-2 active:bg-brand-soft">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{lift.exercise}</span>
                <span className="block text-xs text-muted tabular-nums">
                  {formatDecimal(Number(lift.weight_kg))} × {lift.reps}{lift.rpe ? ` @ ${formatRpe(Number(lift.rpe))}` : ''} · {longDay(lift.date)}
                </span>
              </span>
              {lift.personal_best && (
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold uppercase">{t('stats.personalBest')}</span>
              )}
              <span className="font-display text-xl tabular-nums">{formatDecimal(Number(lift.e1rm))} <span className="text-xs font-normal text-muted">kg</span></span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted">{t('stats.topLiftsHint')}</p>
    </Card>
  )
}

const METRICS: { field: 'sleep_hours' | ScaleField; format: (v: number) => string }[] = [
  { field: 'sleep_hours', format: (v) => `${sleepLabel(Math.round(v))} h` },
  ...SCALE_FIELDS.map(({ field }) => ({ field, format: (v: number) => formatDecimal(Math.round(v * 10) / 10) })),
]

function ReadinessSection({ data }: { data: TrainingStats }) {
  const { t } = useTranslation()
  const entries = data.readiness
  const scores = readinessSeries(entries, 'score')
  const compare = readinessComparison(entries)
  const avgScore = average(scores.map((p) => p.value))
  const answered = average(entries.map((e) => answerCount(e.readiness)))
  return (
    <section className="flex flex-col gap-3" aria-labelledby="stats-readiness">
      <div>
        <h2 id="stats-readiness" className="font-display text-2xl">{t('stats.readiness')}</h2>
        <p className="text-sm text-muted">{t('stats.readinessNote')}</p>
      </div>
      {!entries.length ? (
        <Card><p className="text-muted">{t('stats.readinessEmpty')}</p></Card>
      ) : (
        <>
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{t('stats.readinessScore')}</h3>
              {avgScore !== null && (
                <span className="text-sm text-muted tabular-nums">{t('stats.average', { value: `${Math.round(avgScore)}%` })}</span>
              )}
            </div>
            <p className="text-xs text-muted">
              {t('stats.checkIns', { count: entries.length })}{answered !== null && ` · ${t('stats.answersPer', { value: formatDecimal(Math.round(answered * 10) / 10) })}`}
            </p>
            {scores.length > 1 ? (
              <div className="mt-3"><LineChart points={scores} format={(v) => `${Math.round(v)}%`} label={t('stats.readinessScore')} /></div>
            ) : (
              <p className="mt-2 text-sm text-muted">{t('stats.needMore')}</p>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-2">
            {METRICS.map(({ field, format }) => {
              const series = readinessSeries(entries, field)
              const avg = average(series.map((p) => p.value))
              const levels = field === 'sleep_hours' ? null : LEVEL_SET[field]
              return (
                <div key={field} className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
                  <p className="truncate text-xs font-medium">{t(field === 'sleep_hours' ? 'readiness.sleep' : `readiness.${field}`)}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {avg === null ? '–' : format(avg)}
                    {avg !== null && levels && (
                      <span className="text-xs font-normal text-muted"> · {t(`readiness.${levels}.${Math.round(avg)}`).toLowerCase()}</span>
                    )}
                  </p>
                  {series.length > 1 && (
                    <LineChart compact points={series} format={format} label={t(field === 'sleep_hours' ? 'readiness.sleep' : `readiness.${field}`)} />
                  )}
                </div>
              )
            })}
          </div>

          <Card>
            <h3 className="font-semibold">{t('stats.compareTitle')}</h3>
            {compare.enough ? (
              <table className="mt-2 w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 font-medium" />
                    <th className="py-1 font-medium">{t('stats.compareSets')}</th>
                    <th className="py-1 font-medium">{t('stats.compareRpe')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(['high', 'low'] as const).map((band) => (
                    <tr key={band} className="border-t border-line">
                      <th scope="row" className="py-2 text-left font-medium">
                        {t(`stats.band_${band}`)} <span className="text-xs font-normal text-muted">({compare[band].count})</span>
                      </th>
                      <td className="py-2">{compare[band].avgSets === null ? '–' : formatDecimal(Math.round(compare[band].avgSets! * 10) / 10)}</td>
                      <td className="py-2">{compare[band].avgRpe === null ? '–' : formatDecimal(Math.round(compare[band].avgRpe! * 10) / 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-1 text-sm text-muted">
                {t('stats.compareNotEnough', { min: MIN_COMPARE, high: compare.high.count, low: compare.low.count })}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">{t('stats.compareNote')}</p>
          </Card>
          <RecentCheckIns data={data} />
        </>
      )}
    </section>
  )
}

function RecentCheckIns({ data }: { data: TrainingStats }) {
  const { t } = useTranslation()
  const recent = [...data.readiness].reverse().slice(0, 5)
  return (
    <Card>
      <h3 className="font-semibold">{t('stats.recentCheckIns')}</h3>
      <ul className="mt-1 flex flex-col">
        {recent.map((e) => {
          const score = readinessScore(e.readiness)
          return (
            <li key={e.session_id} className="border-b border-line last:border-0">
              <Link to={`/trening/istorija/${e.session_id}`} className="flex min-h-12 items-center gap-3 py-2 active:bg-brand-soft">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  <span className="block text-xs text-muted tabular-nums">
                    {longDay(e.date)} · {t('stats.setsCount', { count: e.working_sets })}{e.avg_rpe ? ` · RPE ${formatRpe(Number(e.avg_rpe))}` : ''}
                  </span>
                </span>
                {score !== null && (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
                    readinessBand(score) === 'low' ? 'bg-danger/10 text-danger' : readinessBand(score) === 'ok' ? 'bg-accent/15' : 'bg-brand text-white'
                  }`}>
                    {score}%
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function HowItIsCounted() {
  const { t } = useTranslation()
  return (
    <details className="rounded-2xl bg-card px-4 shadow-sm ring-1 ring-line/60">
      <summary className="min-h-12 cursor-pointer py-3 font-semibold text-brand-dark">{t('stats.howTitle')}</summary>
      <ul className="flex list-disc flex-col gap-1.5 pb-4 pl-5 text-sm text-muted">
        {(['working', 'muscle', 'volume', 'rpe', 'e1rm', 'weeks', 'readiness'] as const).map((k) => (
          <li key={k}>{t(`stats.how_${k}`)}</li>
        ))}
      </ul>
    </details>
  )
}
