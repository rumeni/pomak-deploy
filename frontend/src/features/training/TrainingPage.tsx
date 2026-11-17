import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import trainingPhoto from '../../assets/photos/training.webp'
import { Button, EmptyState, PageHeader } from '../../components/ui'
import { ActiveWorkoutBanner } from '../workout/ActiveWorkoutBanner'
import { HistoryList } from '../workout/HistoryList'
import { useStartWorkout } from '../workout/useStartWorkout'
import { useRoutines, type Routine } from './api'
import { LanguageMenu } from '../../components/LanguageMenu'
import { ProgramsSection } from './ProgramsSection'

export function TrainingPage() {
  const { t } = useTranslation()
  const { data: routines, isLoading, isError } = useRoutines()
  const start = useStartWorkout()
  const [starting, setStarting] = useState<string | null>(null)

  const onStart = async (routine: Routine | null) => {
    setStarting(routine?.id ?? 'empty')
    try {
      await start(routine)
    } finally {
      setStarting(null)
    }
  }

  return (
    <>
      <PageHeader title={t('training.title')} photo={trainingPhoto} action={<LanguageMenu />} />
      <div className="flex flex-col gap-4 px-4 pb-8">
        <ActiveWorkoutBanner />

        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold tracking-tight">{t('training.myRoutines')}</h2>
          {!!routines?.length && (
            <Link to="/trening/rutine/nova" className="flex min-h-11 items-center rounded-xl px-3 font-semibold text-brand-dark active:bg-brand-soft">
              {t('training.new')}
            </Link>
          )}
        </div>

        {isLoading && <p className="py-6 text-center text-muted">{t('common.loading')}</p>}
        {isError && <p className="py-6 text-center text-danger">{t('training.loadFailed')}</p>}

        {routines?.length === 0 && (
          <EmptyState
            title={t('training.firstRoutine')}
            text={t('training.firstRoutineText')}
            action={
              <Link to="/trening/rutine/nova" className="inline-flex min-h-12 items-center rounded-xl bg-brand px-5 font-semibold text-white">
                {t('training.newRoutine')}
              </Link>
            }
          />
        )}

        {routines?.map((routine) => (
          <RoutineCard key={routine.id} routine={routine} starting={starting === routine.id} onStart={() => void onStart(routine)} />
        ))}

        <Button variant="secondary" onClick={() => void onStart(null)} disabled={starting !== null}>
          {t('workout.startEmpty')}
        </Button>

        <ProgramsSection routines={routines} />

        <HistoryList />
      </div>
    </>
  )
}

function RoutineCard({ routine, starting, onStart }: { routine: Routine; starting: boolean; onStart: () => void }) {
  const { t } = useTranslation()
  const names = routine.exercises.map((e) => e.exercise.name)
  const sets = routine.exercises.reduce((sum, e) => sum + e.sets.filter((s) => s.set_type === 'working').length, 0)

  return (
    <article className="app-card flex items-center gap-3 !p-3">
      <Link to={`/trening/rutine/${routine.id}`} className="min-w-0 flex-1 rounded-xl p-2 active:bg-brand-soft">
        <h3 className="text-lg font-bold tracking-tight">{routine.name}</h3>
        <p className="text-sm text-muted">
          {t('training.exercises', { count: names.length })} · {t('training.workingSets', { count: sets })}
        </p>
        <p className="mt-1 line-clamp-2 text-sm">{names.join(', ')}</p>
      </Link>
      <Button className="shrink-0 px-4" onClick={onStart} disabled={starting}>
        {t('workout.start')}
      </Button>
    </article>
  )
}
