import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, PageHeader } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { errorMessage } from '../../lib/api'
import { formatDecimal, formatLongDate, formatShortDate, fromISODate, getFormatLocale, parseDecimal, toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { totals } from '../diary/model'
import { useDiaryDay } from '../diary/store'
import { useAddMeasurement, useMeasurements, useWeek } from '../progress/api'
import { mondayOf } from '../progress/week'
import { useRoutines } from '../training/api'
import { ActiveWorkoutBanner } from '../workout/ActiveWorkoutBanner'
import { useSessions } from '../workout/api'
import { fromOutbox, fromServer } from '../workout/history'
import { usePendingSessions } from '../workout/outbox'
import { useStartWorkout } from '../workout/useStartWorkout'
import { nextRoutine } from './next'
import { progressDate, weekActivity, workoutCountWithPending } from './week'
import { LanguageMenu } from '../../components/LanguageMenu'

const linkClass = 'flex min-h-11 items-center text-sm font-semibold text-brand-dark'

/** Početni ekran: sledeći trening, ishrana danas, težina — sa brzim ulazima. */
export function TodayPage() {
  const { me } = useAuth()
  const { t } = useTranslation()
  const profile = me?.profile
  const name = profile?.display_name

  return (
    <>
      <PageHeader
        title={name ? t('today.greeting', { name }) : t('today.title')}
        subtitle={formatLongDate(new Date())}
        action={
          <>
            <LanguageMenu />
            <Link
              to="/profil"
              aria-label={t('today.profileAria')}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand-dark"
            >
              {(name || me?.email || '?').charAt(0).toUpperCase()}
            </Link>
          </>
        }
      />
      <div className="today-main">
        <TodayHero ownerId={me?.id} tracksTraining={!!profile?.tracks_training} tracksNutrition={!!profile?.tracks_nutrition} />
        <div className="mt-4"><ActiveWorkoutBanner /></div>
        <div className="today-dashboard-grid">
          {profile?.tracks_training && <TrainingCard />}
          {profile?.tracks_nutrition && me && <NutritionCard ownerId={me.id} />}
          <WeightCard />
        </div>
      </div>
    </>
  )
}

/** Tamni panel sa stvarnim brojevima: treninzi ove nedelje, kalorije danas, poslednja težina. */
function TodayHero({ ownerId, tracksTraining, tracksNutrition }: { ownerId: string | undefined; tracksTraining: boolean; tracksNutrition: boolean }) {
  const { t } = useTranslation()
  const now = new Date()
  // Workout weeks match the server (Europe/Belgrade), but nutrition days are
  // intentionally local, like the Diary and NutritionCard elsewhere in POMAK.
  const workoutToday = progressDate(now)
  const nutritionToday = toISODate(now)
  const monday = mondayOf(workoutToday)
  const week = useWeek(monday)
  const { data: pages } = useSessions(tracksTraining ? ownerId : undefined)
  const sessions = pages?.pages.flat() ?? []
  // Treninzi koji čekaju slanje (bez interneta) se vide odmah.
  const pending = usePendingSessions(tracksTraining ? ownerId : undefined)
  const { data: weights } = useMeasurements('weight')
  const { day } = useDiaryDay(tracksNutrition ? ownerId : undefined, nutritionToday)

  const weekday = new Intl.DateTimeFormat(getFormatLocale(), { weekday: 'narrow' })
  const { days, trained, unsentThisWeek } = weekActivity((sessions ?? []).map(fromServer), (pending ?? []).map(fromOutbox), monday)
  const workouts = week.data?.workouts
  const latest = weights?.[0]

  return (
    <section className="today-hero" aria-label={t('today.thisWeek')}>
      <div className="topo-layer" aria-hidden />
      <p className="today-hero-kicker">{t('today.thisWeek')}</p>
      <div className="today-stats">
        {tracksTraining && (
          <div className="today-stat">
            <span className="stat-value">
              {workoutCountWithPending(workouts?.count, unsentThisWeek) ?? '–'}
              {workouts?.target ? <small>/{workouts.target}</small> : null}
            </span>
            <span className="stat-label">{t('today.statWorkouts')}</span>
          </div>
        )}
        {tracksNutrition && (
          <div className="today-stat">
            <span className="stat-value">
              {day ? totals(day.entries).kcal : '–'}
              {day?.target ? <small>/{formatDecimal(day.target.kcal)}</small> : null}
            </span>
            <span className="stat-label">{t('today.statKcal')}</span>
          </div>
        )}
        <div className="today-stat">
          <span className="stat-value">{latest ? formatDecimal(Number(latest.value)) : '–'}</span>
          <span className="stat-label">{t('today.statWeight')}</span>
        </div>
      </div>
      {tracksTraining && (
        <div className="today-week" aria-hidden>
          {days.map((d) => (
            <div key={d} className={`today-day ${trained.has(d) ? 'is-done' : ''} ${d === workoutToday ? 'is-today' : ''}`}>
              <span />
              {weekday.format(fromISODate(d))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TrainingCard() {
  const { t } = useTranslation()
  const { data: routines, isLoading } = useRoutines()
  const { me } = useAuth()
  const { data: pages } = useSessions(me?.id)
  const sessions = pages?.pages.flat() ?? []
  const week = useWeek(mondayOf(toISODate(new Date())))
  const start = useStartWorkout()
  const [starting, setStarting] = useState(false)

  const today = toISODate(new Date())
  const doneToday = sessions?.filter((s) => toISODate(new Date(s.started_at)) === today) ?? []
  const next = routines ? nextRoutine(routines, sessions ?? []) : null
  const onStart = async (routine: Parameters<typeof start>[0]) => {
    setStarting(true)
    try {
      await start(routine)
    } finally {
      setStarting(false)
    }
  }

  return (
    <Card className="dashboard-card dashboard-card--training">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{t('today.training')}</h2>
        {week.data && (
          <span className="text-sm text-muted tabular-nums">
            {week.data.workouts.target
              ? t('today.weekCount', {
                  count: week.data.workouts.count,
                  target: week.data.workouts.target,
                })
              : t('today.weekCountNoTarget', {
                  count: week.data.workouts.count,
                })}
          </span>
        )}
      </div>
      {doneToday.length > 0 && (
        <p className="mt-1 text-sm text-brand-dark">
          ✓{' '}
          {t('today.doneToday', {
            name: doneToday.map((s) => s.name).join(', '),
          })}
        </p>
      )}
      {isLoading && <p className="py-2 text-muted">{t('common.loading')}</p>}
      {next ? (
        <>
          <p className="mt-5 text-xs font-bold uppercase tracking-widest text-muted">{t('today.nextWorkout')}</p>
          <p className="mt-1 text-xl font-bold tracking-tight">{next.name}</p>
          <p className="truncate text-sm text-muted">{next.exercises.map((e) => e.exercise.name).join(' · ')}</p>
          <Button className="mt-3 w-full" onClick={() => void onStart(next)} disabled={starting}>
            {t('today.start', { name: next.name })}
          </Button>
          <div className="mt-1 flex justify-between">
            <button type="button" className={linkClass} onClick={() => void onStart(null)} disabled={starting}>
              {t('today.emptyWorkout')}
            </button>
            <Link to="/trening" className={linkClass}>
              {t('today.allRoutines')}
            </Link>
          </div>
        </>
      ) : (
        routines && (
          <>
            <p className="mt-2 text-sm text-muted">{t('today.noRoutines')}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Link
                to="/trening/rutine/nova"
                className="flex min-h-12 items-center justify-center rounded-xl bg-brand font-semibold text-white active:bg-brand-dark"
              >
                {t('training.newRoutine')}
              </Link>
              <Button variant="ghost" onClick={() => void onStart(null)} disabled={starting}>
                {t('today.emptyWorkout')}
              </Button>
            </div>
          </>
        )
      )}
    </Card>
  )
}

function NutritionCard({ ownerId }: { ownerId: string }) {
  const { t } = useTranslation()
  const today = toISODate(new Date())
  // Radi i bez interneta: dan je sačuvan na telefonu.
  const { day } = useDiaryDay(ownerId, today)
  if (!day) return null
  const tot = totals(day.entries)
  const target = day.target ?? null
  const share = target ? Math.min(1, tot.kcal / target.kcal) : 0
  const diff = target ? target.kcal - tot.kcal : 0

  return (
    <Card className="dashboard-card dashboard-card--nutrition">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{t('today.nutrition')}</h2>
        <Link to="/ishrana" className={`-my-2 ${linkClass}`}>
          {t('today.openDiary')}
        </Link>
      </div>
      <p className="dashboard-metric mt-3 tabular-nums">
        {tot.kcal}
        {target && <span className="text-xl font-semibold text-muted"> / {formatDecimal(target.kcal)}</span>}{' '}
        <span className="text-base font-medium text-muted">{t('nutrition.kcal')}</span>
      </p>
      {target ? (
        <>
          <div className="dashboard-progress mt-4" aria-hidden>
            <div style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <p className="mt-1 text-sm text-muted tabular-nums">
            {diff >= 0 ? t('diary.remaining', { kcal: formatDecimal(diff) }) : t('diary.overTarget', { kcal: formatDecimal(-diff) })}
          </p>
        </>
      ) : (
        <Link to="/ishrana/cilj" className={linkClass}>
          {t('today.setTarget')}
        </Link>
      )}
      {day.entries.length > 0 && (
        <p className="mt-1 text-sm text-muted tabular-nums">
          {t('nutrition.proteinShort')} {formatDecimal(tot.protein.value)} g · {t('nutrition.carbsShort')} {formatDecimal(tot.carbs.value)} g ·{' '}
          {t('nutrition.fatShort')} {formatDecimal(tot.fat.value)} g
        </p>
      )}
      {day.entries.length === 0 && <p className="mt-1 text-sm">{t('today.nothingYet')}</p>}
      <Link
        to={`/ishrana?datum=${today}`}
        className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-brand-soft font-semibold text-brand-dark active:bg-line"
      >
        {t('today.addMeal')}
      </Link>
    </Card>
  )
}

function WeightCard() {
  const { t } = useTranslation()
  const { data } = useMeasurements('weight')
  const add = useAddMeasurement()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Isti ID pri ponovnom pokušaju: server neće upisati merenje dva puta.
  const id = useRef(uuid())
  const latest = data?.[0]
  const today = toISODate(new Date())

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const n = parseDecimal(value)
    if (n === null) return setError(t('progress.invalidValue'))
    add.mutate(
      { id: id.current, kind: 'weight', value: String(n), measured_on: today },
      {
        onSuccess: () => {
          id.current = uuid()
          setValue('')
          setSaved(true)
        },
      },
    )
  }

  return (
    <Card className="dashboard-card dashboard-card--weight">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{t('progress.bodyWeight')}</h2>
        <Link to="/napredak/merenja" className={`-my-2 ${linkClass}`}>
          {t('progress.allMeasurements')}
        </Link>
      </div>
      {latest && (
        <p className="text-sm text-muted tabular-nums">
          {t('today.lastWeight', {
            value: formatDecimal(Number(latest.value)),
            date: latest.measured_on === today ? t('diary.today').toLowerCase() : formatShortDate(latest.measured_on),
          })}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
          inputMode="decimal"
          placeholder={t('today.weightPlaceholder')}
          aria-label={t('today.weightToday')}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base tabular-nums outline-none focus:border-brand focus:bg-card"
        />
        <Button type="submit" disabled={add.isPending} className="shrink-0">
          {t('today.saveWeight')}
        </Button>
      </form>
      {saved && <p className="mt-1 text-sm text-brand-dark">✓ {t('today.weightSaved')}</p>}
      {(error || add.isError) && <p className="mt-1 text-sm text-danger">{error ?? errorMessage(add.error)}</p>}
    </Card>
  )
}
