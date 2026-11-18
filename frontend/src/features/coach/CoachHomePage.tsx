import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { accessRegistry, dashboardAccess, visibleTaskList } from './access'
import { useCoachDashboard, useCoachTasks, useTaskAction } from './api'
import { CoachHeader } from './SpaceSwitch'
import { taskText } from './taskText'
import { groupTasks, type CoachTask, type TaskState } from './tasks'
import { initials } from './workspace'

/** The coach's overview: a few numbers, then the list of things to look at. */
export function CoachHomePage() {
  const { t } = useTranslation()
  const dashboard = useCoachDashboard()
  const tasks = useCoachTasks()
  const [view, setView] = useState<TaskState>('open')
  const data = dashboard.data?.role === 'coach' ? dashboard.data : null
  // Tasks of clients no longer listed, or readiness tasks without that consent, never show.
  const registry = accessRegistry(useQueryClient())
  const groups = groupTasks(visibleTaskList(tasks.data ?? [], dashboardAccess(dashboard.data, registry), registry))
  const activeClients = data?.clients.filter((c) => c.status !== 'paused').length ?? 0

  return (
    <>
      <CoachHeader title={t('coachSpace.overviewTitle')} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <div className="grid grid-cols-3 gap-2" aria-live="polite">
          <Stat value={data ? activeClients : null} label={t('coachSpace.stats.activeClients')} to="/trener/klijenti" />
          <Stat value={data?.workouts_today ?? null} label={t('coachSpace.stats.workoutsToday')} />
          <Stat value={tasks.data ? groups.open.length : null} label={t('coachSpace.stats.toReview')} />
        </div>

        <div className="flex gap-2" role="tablist" aria-label={t('coachSpace.tasksTitle')}>
          {(['open', 'snoozed', 'done'] as const).map((state) => (
            <button
              key={state}
              type="button"
              role="tab"
              aria-selected={view === state}
              onClick={() => setView(state)}
              className={`min-h-10 flex-1 whitespace-nowrap rounded-full border px-2 text-[13px] font-semibold ${view === state ? 'border-brand bg-brand text-white' : 'border-line bg-card'}`}
            >
              {t(`coachSpace.taskViews.${state}`)}{tasks.data ? <span className="ml-1 opacity-70">{groups[state].length}</span> : null}
            </button>
          ))}
        </div>

        {tasks.isLoading && <p className="text-muted">{t('common.loading')}</p>}
        {tasks.isError && !tasks.data && (
          <Card>
            <FormError message={t('errors.loadFailed')} />
            <Button variant="secondary" className="mt-3" onClick={() => void tasks.refetch()}>{t('common.retry')}</Button>
          </Card>
        )}
        {tasks.isError && tasks.data && <p role="status" className="text-sm text-muted">{t('coachSpace.offlineShowingSaved')}</p>}
        {tasks.data && groups[view].length === 0 && (
          <Card className="text-center">
            <p className="font-semibold">{t(`coachSpace.emptyTasks.${view}`)}</p>
            {view === 'open' && data && data.clients.length === 0 && (
              <Link to="/trener/klijenti" className="mt-2 inline-block font-semibold text-brand-dark underline">{t('coachSpace.inviteFirstClient')}</Link>
            )}
          </Card>
        )}
        <ul className="flex flex-col gap-2">
          {groups[view].map((task) => <TaskItem key={task.id} task={task} />)}
        </ul>
      </div>
    </>
  )
}

function Stat({ value, label, to }: { value: number | null; label: string; to?: string }) {
  const body = (
    <>
      <span className="block text-2xl font-extrabold tracking-tight">{value ?? '–'}</span>
      <span className="block text-xs leading-tight text-muted">{label}</span>
    </>
  )
  const className = 'app-card !p-3 block min-h-20'
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>
}

function TaskItem({ task }: { task: CoachTask }) {
  const { t, i18n } = useTranslation()
  const now = new Date()
  const action = useTaskAction()
  const [snoozing, setSnoozing] = useState(false)
  const text = taskText(task, t, i18n.language === 'en', now)
  const act = (body: Parameters<typeof action.mutate>[0]) => action.mutate(body, { onSuccess: () => setSnoozing(false) })
  return (
    <li className="app-card !p-4">
      <div className="flex items-start gap-3">
        <Link
          to={`/trener/klijenti/${task.client.id}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-dark"
          aria-label={task.client.name}
        >
          {initials(task.client.name)}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{task.client.name}</p>
          <p className="text-sm">{text.title}</p>
          {text.detail && <p className="mt-0.5 text-sm text-muted">{text.detail}</p>}
          {task.state === 'snoozed' && task.snoozed_until && (
            <p className="mt-0.5 text-xs text-muted">{t('coachSpace.snoozedUntil', { date: new Date(task.snoozed_until).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }) })}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to={`/trener/klijenti/${task.client.id}`} className="app-button inline-flex min-h-10 items-center justify-center bg-brand-soft px-4 text-sm text-brand-dark">{t('coachSpace.openClient')}</Link>
        {task.state !== 'done' ? (
          <>
            <Button size="sm" disabled={action.isPending} onClick={() => act({ id: task.id, action: 'done' })}>{t('coachSpace.markDone')}</Button>
            {!snoozing ? (
              <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => setSnoozing(true)}>{t('coachSpace.snooze')}</Button>
            ) : ([1, 3, 7] as const).map((days) => (
              <Button key={days} size="sm" variant="ghost" disabled={action.isPending} onClick={() => act({ id: task.id, action: 'snooze', days })}>
                {t('coachSpace.snoozeDays', { count: days })}
              </Button>
            ))}
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => act({ id: task.id, action: 'reopen' })}>{t('coachSpace.reopen')}</Button>
        )}
      </div>
      <FormError message={action.error ? errorMessage(action.error) : null} />
    </li>
  )
}
