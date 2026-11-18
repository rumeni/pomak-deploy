import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { useRoutines } from '../training/api'
import { useTemplates } from './plansApi'
import { CoachHeader } from './SpaceSwitch'

/**
 * Programs (templates: routines on weekdays, assigned to clients) and the coach's routines,
 * edited in the same routine editor as everywhere else.
 */
export function CoachProgramsPage() {
  const { t } = useTranslation()
  const templates = useTemplates()
  const routines = useRoutines()
  const from = { from: '/trener/programi' }
  return (
    <>
      <CoachHeader title={t('coachSpace.programs.title')} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <section className="flex flex-col gap-2" aria-labelledby="templates-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="templates-title" className="text-lg font-bold">{t('coachSpace.templates.title')}</h2>
            <Link to="/trener/programi/sablon/novi" className="app-button inline-flex min-h-10 items-center bg-brand px-4 text-sm text-white">
              {t('coachSpace.templates.new')}
            </Link>
          </div>
          <p className="text-sm text-muted">{t('coachSpace.templates.explanation')}</p>
          {templates.isLoading && <p className="text-muted">{t('common.loading')}</p>}
          {templates.isError && !templates.data && (
            <Card>
              <FormError message={t('errors.loadFailed')} />
              <Button variant="secondary" className="mt-3" onClick={() => void templates.refetch()}>{t('common.retry')}</Button>
            </Card>
          )}
          {templates.data?.length === 0 && <Card className="text-center"><p className="text-muted">{t('coachSpace.templates.empty')}</p></Card>}
          <ul className="flex flex-col gap-2">
            {templates.data?.map((template) => (
              <li key={template.id} className="app-card !p-4">
                <Link to={`/trener/programi/sablon/${template.id}`} className="block">
                  <span className="block font-semibold">{template.name}</span>
                  <span className="block text-xs text-muted">
                    {t('coachSpace.templates.daysPerWeek', { count: template.days.length })}
                    {' · '}
                    {template.weeks ? t('coachSpace.templates.weeks', { count: template.weeks }) : t('coachSpace.templates.noEnd')}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {template.days.map((d) => `${t(`coachSpace.weekdayShort.${d.weekday}`)}: ${d.routine.name}`).join(' · ')}
                  </span>
                </Link>
                <Link to={`/trener/programi/dodela?sablon=${template.id}`} className="app-button mt-3 inline-flex min-h-10 items-center bg-brand-soft px-4 text-sm text-brand-dark">
                  {t('coachSpace.templates.assign')}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 flex flex-col gap-2" aria-labelledby="routines-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="routines-title" className="text-lg font-bold">{t('coachSpace.programs.routines')}</h2>
            <Link to="/trening/rutine/nova" state={from} className="app-button inline-flex min-h-10 items-center bg-brand-soft px-4 text-sm text-brand-dark">
              {t('coachSpace.programs.new')}
            </Link>
          </div>
          <p className="text-sm text-muted">{t('coachSpace.programs.explanation')}</p>
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
        </section>
      </div>
    </>
  )
}
