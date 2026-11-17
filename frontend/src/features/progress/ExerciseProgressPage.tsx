import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Card, LoadingScreen, ScreenHeader } from '../../components/ui'
import { LineChart } from '../../components/LineChart'
import { formatDecimal, formatShortDate, toISODate } from '../../lib/format'
import { describeLogged } from '../workout/model'
import { formatRpe, parseRpe } from '../workout/rpe'
import { useExerciseProgress, type RecordKey } from './api'
import { formatRecordValue } from './format'
import { ExerciseDemo } from '../training/ExerciseImage'
import { ExerciseInstructions } from '../training/ExerciseInstructions'

const RECORD_ORDER: RecordKey[] = [
  'heaviest',
  'e1rm',
  'best_set_volume',
  'session_volume',
  'most_reps',
  'session_reps',
  'longest_distance',
  'longest_duration',
]

/** Napredak u jednoj vežbi: lični rekordi, grafikon po treningu i istorija serija. */
export function ExerciseProgressPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, isLoading, isError } = useExerciseProgress(id)
  const [showE1rm, setShowE1rm] = useState(false)
  const repsUnit = t('routine.phReps')

  if (isLoading) return <LoadingScreen />
  if (isError || !data) {
    return (
      <>
        <ScreenHeader title={t('progress.title')} onBack={() => navigate(-1)} />
        <p className="p-6 text-center text-danger">{t('progress.loadFailed')}</p>
      </>
    )
  }

  const { exercise, records, chart, history } = data
  const recordKeys = RECORD_ORDER.filter((k) => records[k])
  const points = chart.points.map((p) => ({ date: p.date, value: Number(p.value) }))
  const e1rmPoints = (data.e1rm_chart ?? []).map((p) => ({ date: p.date, value: Number(p.value) }))
  const canShowE1rm = e1rmPoints.length > 1

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={exercise.name} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <ExerciseDemo exercise={exercise} compact />
        {exercise.instructions && (
          <details className="rounded-2xl bg-card px-4 shadow-sm ring-1 ring-line/60">
            <summary className="min-h-12 cursor-pointer py-3 font-semibold text-brand-dark">{t('exerciseInfo.howTo')}</summary>
            <div className="pb-4">
              <ExerciseInstructions text={exercise.instructions} />
            </div>
          </details>
        )}
        {exercise.load_mode === 'per_side' && <p className="text-sm text-muted">{t('progress.perSideNote')}</p>}

        {recordKeys.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">{t('progress.records')}</h2>
            <dl className="grid grid-cols-2 gap-2">
              {recordKeys.map((key) => {
                const r = records[key]!
                return (
                  <div key={key} className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
                    <dt className="text-xs text-muted">{t(`progress.record_${key}`)}</dt>
                    <dd className="text-xl font-bold tabular-nums">{formatRecordValue(key, r.value, repsUnit)}</dd>
                    <dd className="text-xs text-muted tabular-nums">
                      {r.weight !== undefined && r.reps !== undefined && key !== 'heaviest'
                        && `${formatDecimal(Number(r.weight))} × ${r.reps}${parseRpe(r.rpe) !== null ? ` @ ${formatRpe(parseRpe(r.rpe)!)}` : ''} · `}
                      {key === 'heaviest' && r.reps !== undefined && `× ${r.reps} · `}
                      {formatShortDate(r.date)}
                    </dd>
                  </div>
                )
              })}
            </dl>
            {records.e1rm && <p className="text-xs text-muted">{t('progress.e1rmNote')}</p>}
          </section>
        )}

        {(points.length > 1 || canShowE1rm) && (
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold">{t(showE1rm && canShowE1rm ? 'progress.chart_e1rm' : `progress.chart_${chart.metric}`)}</h2>
              {canShowE1rm && points.length > 1 && (
                <div className="flex rounded-lg bg-surface p-0.5 text-xs font-semibold" role="group">
                  {[false, true].map((e1rm) => (
                    <button
                      key={String(e1rm)}
                      type="button"
                      aria-pressed={showE1rm === e1rm}
                      onClick={() => setShowE1rm(e1rm)}
                      className={`min-h-9 rounded-md px-3 ${showE1rm === e1rm ? 'bg-card shadow-sm' : 'text-muted'}`}
                    >
                      {e1rm ? '1RM' : t('progress.chartWeight')}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {showE1rm && canShowE1rm || points.length < 2 ? (
              <LineChart points={e1rmPoints} format={(v) => `${formatDecimal(Math.round(v * 10) / 10)} kg`} label={t('progress.chart_e1rm')} />
            ) : (
              <LineChart points={points} format={(v) => formatRecordValue(chart.metric, Math.round(v * 10) / 10, repsUnit)} label={t(`progress.chart_${chart.metric}`)} />
            )}
          </Card>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('progress.history')}</h2>
          {history.length === 0 && <p className="text-muted">{t('progress.noHistory')}</p>}
          {history.map((h) => (
            <Link
              key={h.session_id}
              to={`/trening/istorija/${h.session_id}`}
              className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60 active:bg-brand-soft"
            >
              <p className="flex justify-between gap-3">
                <span className="truncate font-medium">{h.name}</span>
                <span className="shrink-0 text-sm text-muted">{formatShortDate(toISODate(new Date(h.started_at)))}</span>
              </p>
              <p className="mt-1 text-sm tabular-nums text-muted">
                {h.sets
                  .map((s) => `${s.set_type === 'warmup' ? `${t('progress.warmupShort')} ` : ''}${describeLogged(s, exercise, repsUnit, true)}`)
                  .join(' · ')}
              </p>
            </Link>
          ))}
        </section>
      </div>
    </div>
  )
}
