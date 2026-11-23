import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Card, FormError, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { formatDecimal, getFormatLocale } from '../../lib/format'
import { useRoutines } from '../training/api'
import { accessRegistry, dashboardAccess, isAccessRevoked, isNetworkFailure, purgeClient, redactCached, refreshCoachLists, viewableClient, visibleTaskList } from './access'
import {
  useAssignCoachRoutine, useClientStatus, useCoachClient, useCoachDashboard, useCoachNotes, useCoachTasks, useCreateCoachNote,
  useDeleteCoachNote, useDisconnectCoach, useUpdateCoachNote, type CoachClientDetails, type CoachNote,
} from './api'
import { taskLink } from './taskLink'
import { taskText } from './taskText'
import { Avatar } from './Avatar'
import { CoachNutritionDays } from './CoachNutritionDays'
import { formatCoachSet } from './formatCoach'
import { InstructionsPanel } from './Instructions'
import { PlanPanel } from './PlanPanel'
import { PackagesPanel } from '../schedule/PackagesPanel'
import { ClientStats, ClientTargetPanel, WorkoutLinks } from './ClientTabs'
import { MealPlanPanel } from './MealPlanPanel'
import { coachRoutineAvailability } from './routineEligibility'
import { readinessReasons } from './workspace'
import { SupersetBadge } from '../training/SupersetFrame'
import { supersetLabels } from '../training/supersets'

const TABS = ['overview', 'plan', 'progress', 'nutrition', 'notes'] as const
type Tab = (typeof TABS)[number]

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** One client: overview, plan, progress, nutrition and notes. Only data the client shares. */
export function ClientDetail({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? params.get('tab') as Tab : 'overview'
  const client = useCoachClient(clientId)
  const dashboard = useCoachDashboard()
  const qc = useQueryClient()
  // Which data may be shown is decided by server facts (access version, collaboration identity),
  // never by which response arrived last.
  // The client data and the dashboard both report to the account's access registry, which keeps
  // the highest version seen from any source; the task list below judges against it too.
  const registry = accessRegistry(qc)
  const view = viewableClient(client.data, {
    error: client.isError ? client.error : null,
    dashboard: dashboardAccess(dashboard.data, registry),
    registry,
  })
  const revoked = (client.isError && isAccessRevoked(client.error)) || view.purge
  const redactWith = view.redactWith

  // Access gone: forget what was cached. Access changed: drop from the cache what the current
  // consents no longer allow (so it cannot reappear) and load again at the current version.
  useEffect(() => {
    if (view.purge) {
      void purgeClient(qc, clientId)
      return
    }
    if (redactWith) {
      qc.setQueryData<CoachClientDetails>(['coach-client', clientId], (old) => (old ? redactCached(old, redactWith) : old))
    }
    if (view.refresh) void refreshCoachLists(qc, clientId)
  }, [view.purge, view.refresh, redactWith, qc, clientId])

  if (revoked) {
    return (
      <Card>
        <p className="font-semibold">{t('coachSpace.client.noAccess')}</p>
        <p className="mt-1 text-sm text-muted">{t('coachSpace.client.noAccessHint')}</p>
        <Button variant="secondary" className="mt-3" onClick={() => navigate('/trener/klijenti', { replace: true })}>{t('common.back')}</Button>
      </Card>
    )
  }
  const usable = view.data
  if (client.isLoading || (!usable && !client.isError)) return <p className="p-4 text-muted">{t('common.loading')}</p>
  if (!usable) {
    return (
      <Card>
        <p className="text-danger">{isNetworkFailure(client.error) ? t('errors.loadFailed') : t('coach.clientNotFound')}</p>
        <Button variant="secondary" className="mt-3" onClick={() => navigate('/trener/klijenti')}>{t('common.back')}</Button>
      </Card>
    )
  }
  const data = usable
  const connection = data.connection

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={connection.client.name}>
      <div className="pt-safe flex items-center gap-2 min-[980px]:pt-0">
        <button type="button" onClick={() => navigate('/trener/klijenti')} aria-label={t('common.back')} className="flex size-11 items-center justify-center rounded-full active:bg-line min-[980px]:hidden">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <Avatar name={connection.client.name} size="lg" muted={connection.status === 'paused'} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-tight">{connection.client.name}</h1>
          <p className="text-sm text-muted">
            {t(`coachSpace.status.${connection.status ?? 'active'}`)} · {t('coach.connectedAt', { date: dateLabel(connection.connected_at) })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={`/trener/poruke/${connection.id}`} className="app-button app-button-primary inline-flex min-h-10 items-center justify-center bg-brand px-4 text-sm text-white">{t('coachSpace.client.message')}</Link>
        <StatusButton clientId={clientId} paused={connection.status === 'paused'} />
      </div>
      {client.isError && <p role="status" className="text-sm text-muted">{t('coachSpace.offlineShowingSaved')}</p>}

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('coachSpace.client.sections')}>
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setParams(value === 'overview' ? {} : { tab: value }, { replace: true })}
            className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold ${tab === value ? 'border-brand bg-brand text-white' : 'border-line bg-card'}`}
          >
            {t(`coachSpace.client.tabs.${value}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <><OverviewTab data={data} /><PackagesPanel clientId={clientId} /></>}
      {tab === 'plan' && <><PlanPanel clientId={clientId} /><InstructionsPanel clientId={clientId} /><PlanTab clientId={clientId} data={data} /></>}
      {tab === 'progress' && <ProgressTab clientId={clientId} data={data} />}
      {tab === 'nutrition' && (
        <>
          <ClientTargetPanel clientId={clientId} />
          <MealPlanPanel clientId={clientId} />
          <Card title={t('coach.nutrition')}>
            {data.nutrition_days === null ? <p className="text-muted">{t('coach.notShared')}</p>
              : data.nutrition_days.length === 0 ? <p className="text-muted">{t('coach.noNutrition')}</p>
                : <CoachNutritionDays days={data.nutrition_days} />}
          </Card>
        </>
      )}
      {tab === 'notes' && <NotesPanel connectionId={connection.id} />}

      <RemoveClient clientId={clientId} />
    </section>
  )
}

function StatusButton({ clientId, paused }: { clientId: string; paused: boolean }) {
  const { t } = useTranslation()
  const change = useClientStatus(clientId)
  return (
    <>
      <Button size="sm" variant="secondary" disabled={change.isPending} onClick={() => change.mutate(paused ? 'active' : 'paused')}>
        {t(paused ? 'coachSpace.client.resume' : 'coachSpace.client.pause')}
      </Button>
      {!paused && <p className="w-full text-xs text-muted">{t('coachSpace.client.pauseHint')}</p>}
      <FormError message={change.error ? errorMessage(change.error) : null} />
    </>
  )
}

function OverviewTab({ data }: { data: CoachClientDetails }) {
  const { t, i18n } = useTranslation()
  const tasks = useCoachTasks()
  const dashboard = useCoachDashboard()
  const registry = accessRegistry(useQueryClient())
  const open = visibleTaskList(tasks.data ?? [], dashboardAccess(dashboard.data, registry), registry)
    .filter((task) => task.client.id === data.connection.client.id && task.state === 'open')
  const last = data.recent_workouts[0]
  const withReadiness = data.recent_workouts.find((w) => w.readiness?.score != null)
  const now = new Date()
  return (
    <>
      {open.length > 0 && (
        <Card title={t('coachSpace.client.openTasks')}>
          <ul className="flex flex-col gap-2">
            {open.map((task) => {
              const text = taskText(task, t, i18n.language === 'en', now)
              const body = <><span className="font-semibold">{text.title}</span>{text.detail && <span className="text-muted"> · {text.detail}</span>}</>
              return (
                <li key={task.id} className="text-sm">
                  {taskLink(task).kind !== 'client' ? <Link to={taskLink(task).to} className="underline-offset-2 hover:underline">{body}</Link> : body}
                </li>
              )
            })}
          </ul>
          <Link to="/trener" className="mt-3 inline-block text-sm font-semibold underline">{t('coachSpace.client.toOverview')}</Link>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="app-card !p-3">
          <span className="block text-2xl font-extrabold">{data.workouts_30d}</span>
          <span className="text-xs text-muted">{t('coachSpace.client.workouts30d')}</span>
        </div>
        <div className="app-card !p-3">
          <span className="block text-2xl font-extrabold">{withReadiness?.readiness?.score != null ? `${withReadiness.readiness.score}%` : '–'}</span>
          <span className="text-xs text-muted">
            {t('coachSpace.client.lastReadiness')}{data.connection.share_readiness === false ? ` · ${t('coach.notSharedShort')}` : ''}
          </span>
        </div>
      </div>
      {withReadiness?.readiness && readinessReasons(withReadiness.readiness.answers).length > 0 && (
        <p className="text-sm text-muted">
          {readinessReasons(withReadiness.readiness.answers).map(({ field, value }) =>
            field === 'sleep_hours' ? t('readiness.sleepValue', { value }) : `${t(`readiness.${field}`)} ${value}/5`).join(' · ')}
        </p>
      )}
      <Link to={`/trener/klijenti/${data.connection.client.id}/nedelja`} className="app-card flex items-center justify-between !p-4">
        <span>
          <span className="block font-semibold">{t('coachSpace.week.open')}</span>
          <span className="block text-xs text-muted">{t('coachSpace.week.openHint')}</span>
        </span>
        <span className="text-muted" aria-hidden>›</span>
      </Link>
      <Card title={t('coachSpace.client.lastWorkoutTitle')}>
        {last ? <WorkoutSummary workout={last} /> : <p className="text-muted">{t('coach.noWorkouts')}</p>}
      </Card>
      <Card title={t('coach.goals')}>
        {data.goals.length === 0 && <p className="text-muted">{t('coach.noGoals')}</p>}
        {data.goals.map((goal) => (
          <p key={goal.kind} className="py-1 text-sm">{t(`coach.goalKinds.${goal.kind}` as const, { defaultValue: goal.kind })}: <strong>{formatDecimal(Number(goal.target_value))}</strong></p>
        ))}
        <p className="mt-2 text-xs text-muted">{t('coach.sharedInformation')}</p>
      </Card>
    </>
  )
}

function WorkoutSummary({ workout }: { workout: CoachClientDetails['recent_workouts'][number] }) {
  const { t } = useTranslation()
  const supersets = supersetLabels(workout.exercises)
  return (
    <div>
      <p className="font-semibold">{workout.name}</p>
      <p className="text-sm text-muted">
        {dateLabel(workout.started_at)}
        {workout.feeling != null ? ` · ${t('coach.feeling', { value: workout.feeling })}` : ''}
        {workout.readiness?.score != null ? ` · ${t('readiness.score', { value: workout.readiness.score })}` : ''}
      </p>
      {workout.exercises.map((item, index) => (
        <div key={`${item.name}-${index}`} className="mt-1 text-sm">
          <span><SupersetBadge label={supersets[index]} />{item.name}: </span>
          <span className="text-muted">{item.sets.map((set) => formatCoachSet(set, `${t('routine.warmupShort')}:`, t('coach.reps'), item.unilateral)).join(', ')}</span>
        </div>
      ))}
      {workout.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{workout.notes}</p>}
    </div>
  )
}

function ProgressTab({ clientId, data }: { clientId: string; data: CoachClientDetails }) {
  const { t } = useTranslation()
  return (
    <>
      <WorkoutLinks clientId={clientId} workouts={data.recent_workouts} />
      <ClientStats clientId={clientId} />
      <Card title={t('coach.measurements')}>
        {data.measurements === null ? <p className="text-muted">{t('coach.notShared')}</p> : (
          data.measurements.length === 0 ? <p className="text-muted">{t('coach.noMeasurements')}</p> :
            data.measurements.map((m, idx) => (
              <p key={`${m.kind}-${m.measured_on}-${idx}`} className="border-b border-line py-2 text-sm last:border-0">
                {t(`coach.goalKinds.${m.kind}` as const, { defaultValue: m.kind })}: {formatDecimal(Number(m.value))} {m.unit} · {dateLabel(m.measured_on)}
              </p>
            ))
        )}
      </Card>
    </>
  )
}

function PlanTab({ clientId, data }: { clientId: string; data: CoachClientDetails }) {
  const { t } = useTranslation()
  const routines = useRoutines()
  const assign = useAssignCoachRoutine(clientId)
  const [routineId, setRoutineId] = useState('')
  const availableRoutines = (routines.data ?? []).filter((routine) => coachRoutineAvailability(routine) === 'ready')
  const unavailableRoutines = (routines.data ?? []).filter((routine) => coachRoutineAvailability(routine) !== 'ready')
  return (
    <Card title={t('coachSpace.plan.singleRoutine')}>
      <p className="mb-3 text-sm text-muted">{t('coach.assignExplanation')}</p>
      {routines.isError && <FormError message={t('errors.loadFailed')} />}
      <label className="mb-1 block text-sm font-medium" htmlFor="coach-routine-select">{t('coach.selectRoutine')}</label>
      <select id="coach-routine-select" className={selectClass + ' w-full'} value={routineId} onChange={(e) => setRoutineId(e.target.value)}>
        <option value="">{t('coach.selectRoutine')}</option>
        {availableRoutines.map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
        {unavailableRoutines.map((routine) => (
          <option key={`unavailable-${routine.id}`} value={`unavailable:${routine.id}`} disabled>
            {routine.name} · {t(`coachSpace.templates.routine_${coachRoutineAvailability(routine)}`)}
          </option>
        ))}
      </select>
      {routines.data && availableRoutines.length === 0 && <p role="status" className="mt-2 text-sm text-muted">{t('coachSpace.client.noSharedRoutines')}</p>}
      {unavailableRoutines.length > 0 && <p className="mt-2 text-xs text-muted">{t('coachSpace.templates.unavailableHint')}</p>}
      <FormError message={assign.error ? errorMessage(assign.error) : null} />
      <Button className="mt-3 w-full" disabled={!routineId || assign.isPending} onClick={() => assign.mutate(routineId, { onSuccess: () => setRoutineId('') })}>
        {t('coach.assign')}
      </Button>
      {assign.isSuccess && <p role="status" className="mt-2 text-sm text-brand-dark">{t('coach.assigned')}</p>}
      <div className="mt-4 border-t border-line pt-3">
        <p className="text-sm font-semibold">{t('coach.assignedRoutines')}</p>
        {data.assignments.length === 0 && <p className="text-sm text-muted">{t('coachSpace.client.noAssignments')}</p>}
        {data.assignments.map((assignment) => (
          <p className="text-sm text-muted" key={assignment.id}>{assignment.name} · {dateLabel(assignment.assigned_at)}</p>
        ))}
      </div>
    </Card>
  )
}

/** Notes: private ones only the coach ever sees; shared ones the client sees on the Coach tab. */
export function NotesPanel({ connectionId, readOnly = false }: { connectionId: string; readOnly?: boolean }) {
  const { t } = useTranslation()
  const notes = useCoachNotes(connectionId)
  const create = useCreateCoachNote(connectionId)
  const [text, setText] = useState('')
  const [shared, setShared] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    create.mutate({ text: text.trim(), visible_to_client: shared }, { onSuccess: () => { setText(''); setShared(false) } })
  }
  return (
    <Card title={t('coachSpace.notes.title')}>
      {!readOnly && (
        <form className="mb-4 flex flex-col gap-2" onSubmit={submit}>
          <label htmlFor="coach-note" className="text-sm font-medium">{t('coachSpace.notes.new')}</label>
          <textarea id="coach-note" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} className="w-full rounded-xl border border-line bg-card p-3 outline-none focus:border-brand" />
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t('coachSpace.notes.visibility')}</legend>
            <label className="flex items-center gap-3 text-sm">
              <input type="radio" name="note-visibility" checked={!shared} onChange={() => setShared(false)} className="size-5 accent-brand" />
              <span><strong>{t('coachSpace.notes.private')}</strong> · {t('coachSpace.notes.privateHint')}</span>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="radio" name="note-visibility" checked={shared} onChange={() => setShared(true)} className="size-5 accent-brand" />
              <span><strong>{t('coachSpace.notes.shared')}</strong> · {t('coachSpace.notes.sharedHint')}</span>
            </label>
          </fieldset>
          <FormError message={create.error ? errorMessage(create.error) : null} />
          <Button disabled={create.isPending || !text.trim()}>{t('coachSpace.notes.add')}</Button>
        </form>
      )}
      {notes.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {notes.isError && !notes.data && <FormError message={t('errors.loadFailed')} />}
      {notes.data?.length === 0 && <p className="text-muted">{t('coachSpace.notes.empty')}</p>}
      <ul className="flex flex-col gap-2">
        {notes.data?.map((note) => <NoteItem key={note.id} note={note} connectionId={connectionId} readOnly={readOnly} />)}
      </ul>
    </Card>
  )
}

function NoteItem({ note, connectionId, readOnly }: { note: CoachNote; connectionId: string; readOnly: boolean }) {
  const { t } = useTranslation()
  const update = useUpdateCoachNote(connectionId)
  const remove = useDeleteCoachNote(connectionId)
  const [editing, setEditing] = useState<string | null>(null)
  if (editing !== null) {
    return (
      <li className="rounded-xl border border-brand p-3">
        <label htmlFor={`note-${note.id}`} className="sr-only">{t('coachSpace.notes.edit')}</label>
        <textarea id={`note-${note.id}`} value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={2000} rows={3}
          className="w-full rounded-xl border border-line bg-card p-3 outline-none focus:border-brand" />
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={update.isPending || !editing.trim()} onClick={() => update.mutate({ id: note.id, text: editing.trim() }, { onSuccess: () => setEditing(null) })}>
            {t('common.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('coachSpace.notes.cancel')}</Button>
        </div>
        <FormError message={update.error ? errorMessage(update.error) : null} />
      </li>
    )
  }
  return (
    <li className={`rounded-xl border p-3 ${note.visible_to_client ? 'border-brand/40 bg-brand-soft/40' : 'border-line bg-card'}`}>
      <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${note.visible_to_client ? 'text-brand-dark' : 'text-muted'}`}>
        {t(note.visible_to_client ? 'coachSpace.notes.sharedBadge' : 'coachSpace.notes.privateBadge')} · {dateLabel(note.created_at)}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => { update.reset(); setEditing(note.text) }}>{t('coachSpace.notes.edit')}</Button>
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => {
            if (note.visible_to_client || window.confirm(t('coachSpace.notes.shareConfirm'))) {
              update.mutate({ id: note.id, visible_to_client: !note.visible_to_client })
            }
          }}>
            {t(note.visible_to_client ? 'coachSpace.notes.makePrivate' : 'coachSpace.notes.makeShared')}
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" disabled={remove.isPending} onClick={() => {
            if (window.confirm(t('coachSpace.notes.deleteConfirm'))) remove.mutate(note.id)
          }}>
            {t('coachSpace.notes.delete')}
          </Button>
        </div>
      )}
      <FormError message={update.error ? errorMessage(update.error) : remove.error ? errorMessage(remove.error) : null} />
    </li>
  )
}

function RemoveClient({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const disconnect = useDisconnectCoach()
  return (
    <>
      <FormError message={disconnect.error ? errorMessage(disconnect.error) : null} />
      <Button variant="ghost" className="mt-2 w-full text-danger" disabled={disconnect.isPending} onClick={() => {
        if (window.confirm(t('coach.removeClientConfirm'))) disconnect.mutate(clientId, { onSuccess: () => navigate('/trener/klijenti', { replace: true }) })
      }}>{t('coach.removeClient')}</Button>
    </>
  )
}
