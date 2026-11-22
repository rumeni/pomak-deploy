import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import progressPhoto from '../../assets/photos/progress.webp'
import { Card, EmptyState, PageHeader } from '../../components/ui'
import { LineChart } from '../../components/LineChart'
import { formatDecimal, formatShortDate, toISODate } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { usePerformedExercises, useMeasurements } from './api'
import { measurementPoints } from './format'
import { adultBmi } from './bmi'
import { BmiPanel } from './BmiPanel'
import { GoalsSection } from './GoalsSection'
import { WeekCard } from './WeekCard'
import { ExerciseThumb } from '../training/ExerciseImage'

/** Napredak: nedeljni pregled, ciljevi, telesna težina i vežbe koje je korisnik radio. */
export function ProgressPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const pendingNotice = (location.state as { goalConflictNotice?: boolean } | null)?.goalConflictNotice === true
  // Preserve the notice on screen while consuming it from browser history.
  // A refresh or back/forward visit must not replay a stale conflict warning.
  const [goalConflictNotice] = useState(() => pendingNotice)

  useEffect(() => {
    if (pendingNotice) navigate('.', { replace: true, state: null })
  }, [pendingNotice, navigate])

  return (
    <>
      <PageHeader title={t('progress.title')} photo={progressPhoto} />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {goalConflictNotice && (
          <p role="alert" className="rounded-2xl bg-card p-3 text-sm text-ink ring-1 ring-line">
            {t('progress.goalConflictNotice')}
          </p>
        )}
        <WeekCard />
        <Link to="/napredak/nedelja" className="flex items-center gap-3 rounded-2xl bg-card px-4 py-4 ring-1 ring-line active:bg-brand-soft">
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl">{t('week.open')}</span>
            <span className="block text-sm text-muted">{t('week.openHint')}</span>
          </span>
          <span aria-hidden className="text-2xl text-accent">›</span>
        </Link>
        <Link
          to="/napredak/statistika"
          className="flex items-center gap-3 rounded-2xl bg-ink px-4 py-4 text-white shadow-sm active:opacity-90"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl">{t('stats.open')}</span>
            <span className="block text-sm text-white/70">{t('stats.openHint')}</span>
          </span>
          <span aria-hidden className="text-2xl text-accent">›</span>
        </Link>
        <GoalsSection />
        <WeightCard />
        <ExercisesCard />
      </div>
    </>
  )
}

function WeightCard() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { data, isLoading, isError } = useMeasurements('weight')
  const latest = data?.[0]
  const points = data ? measurementPoints(data) : []
  const bmi = latest && me
    ? adultBmi(Number(latest.value), me.profile.height_cm ? Number(me.profile.height_cm) : NaN,
      me.profile.birth_date, latest.measured_on)
    : null
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
          {bmi && me && <BmiPanel bmi={bmi} ownerId={me.id} showCategory={me.profile.show_bmi_category === true} />}
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
