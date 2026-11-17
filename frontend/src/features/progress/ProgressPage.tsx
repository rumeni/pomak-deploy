import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'

import { Card, EmptyState, PageHeader } from '../../components/ui'
import { LineChart } from '../../components/LineChart'
import { formatDecimal, formatShortDate, toISODate } from '../../lib/format'
import { usePerformedExercises, useMeasurements } from './api'
import { measurementPoints } from './format'
import { GoalsSection } from './GoalsSection'
import { WeekCard } from './WeekCard'
import { ExerciseThumb } from '../training/ExerciseImage'
import { LanguageMenu } from '../../components/LanguageMenu'

/** Napredak: nedeljni pregled, ciljevi, telesna težina i vežbe koje je korisnik radio. */
export function ProgressPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const goalConflictNotice = (location.state as { goalConflictNotice?: boolean } | null)?.goalConflictNotice === true
  return (
    <>
      <PageHeader title={t('progress.title')} action={<LanguageMenu />} />
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-8">
        {goalConflictNotice && (
          <p role="alert" className="rounded-2xl bg-card p-3 text-sm text-ink ring-1 ring-line">
            {t('progress.goalConflictNotice')}
          </p>
        )}
        <WeekCard />
        <GoalsSection />
        <WeightCard />
        <ExercisesCard />
      </div>
    </>
  )
}

function WeightCard() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useMeasurements('weight')
  const latest = data?.[0]
  const points = data ? measurementPoints(data) : []
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{t('progress.bodyWeight')}</h2>
        <Link to="/napredak/merenja" className="-my-2 flex min-h-11 items-center text-sm font-semibold text-brand-dark">
          {t('progress.allMeasurements')}
        </Link>
      </div>
      {isLoading && <p className="py-2 text-muted">{t('common.loading')}</p>}
      {isError && <p className="py-2 text-danger">{t('progress.loadFailed')}</p>}
      {data && !latest && <p className="py-2 text-muted">{t('progress.noWeight')}</p>}
      {latest && (
        <>
          <p className="dashboard-metric mt-2 tabular-nums">
            {formatDecimal(Number(latest.value))} <span className="text-base font-medium text-muted">kg</span>
          </p>
          <p className="text-sm text-muted">{t('progress.measuredOn', { date: formatShortDate(latest.measured_on) })}</p>
          {points.length > 1 && (
            <div className="mt-3">
              <LineChart points={points} format={(v) => `${formatDecimal(Math.round(v * 10) / 10)} kg`} label={t('progress.bodyWeight')} />
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function ExercisesCard() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = usePerformedExercises()
  if (isLoading) return <p className="py-2 text-center text-muted">{t('common.loading')}</p>
  if (isError) return <p className="py-2 text-center text-danger">{t('progress.loadFailed')}</p>
  if (!data?.length) return <EmptyState title={t('progress.noExercisesTitle')} text={t('progress.noExercisesText')} />
  const today = toISODate(new Date())
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{t('progress.exercises')}</h2>
      <ul className="flex flex-col overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-line/60">
        {data.map(({ exercise, last_performed, sessions }) => {
          const last = toISODate(new Date(last_performed))
          return (
            <li key={exercise.id} className="border-b border-line last:border-0">
              <Link to={`/napredak/vezba/${exercise.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-2 active:bg-brand-soft">
                <ExerciseThumb exercise={exercise} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{exercise.name}</span>
                  <span className="block text-sm text-muted">
                    {t('progress.sessionsCount', { count: sessions })} · {last === today ? t('diary.today') : formatShortDate(last)}
                  </span>
                </span>
                <span aria-hidden className="text-muted">
                  ›
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
