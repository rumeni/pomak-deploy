import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { useRoutines } from '../training/api'
import { CoachHeader } from './SpaceSwitch'

/**
 * The coach's routines, edited in the same routine editor as everywhere else. A routine is
 * given to a client from the client's Plan tab (templates for many clients come later).
 */
export function CoachProgramsPage() {
  const { t } = useTranslation()
  const routines = useRoutines()
  const from = { from: '/trener/programi' }
  return (
    <>
      <CoachHeader title={t('coachSpace.programs.title')} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <p className="text-sm text-muted">{t('coachSpace.programs.explanation')}</p>
        <Link to="/trening/rutine/nova" state={from} className="app-button app-button-primary flex min-h-12 items-center justify-center bg-brand px-5 text-white">
          {t('coachSpace.programs.new')}
        </Link>
        {routines.isLoading && <p className="text-muted">{t('common.loading')}</p>}
        {routines.isError && !routines.data && (
          <Card>
            <FormError message={t('errors.loadFailed')} />
            <Button variant="secondary" className="mt-3" onClick={() => void routines.refetch()}>{t('common.retry')}</Button>
          </Card>
        )}
        {routines.data?.length === 0 && <Card className="text-center"><p className="text-muted">{t('coachSpace.programs.empty')}</p></Card>}
        <ul className="flex flex-col gap-2">
          {routines.data?.map((routine) => {
            const custom = routine.exercises.some((item) => item.exercise.is_custom)
            return (
              <li key={routine.id}>
                <Link to={`/trening/rutine/${routine.id}`} state={from} className="app-card flex items-center justify-between gap-3 !p-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{routine.name}</span>
                    <span className="block text-xs text-muted">
                      {t('coachSpace.programs.exercises', { count: routine.exercises.length })}
                      {custom ? ` · ${t('coachSpace.programs.customWarning')}` : ''}
                    </span>
                  </span>
                  <span className="text-muted" aria-hidden>›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
