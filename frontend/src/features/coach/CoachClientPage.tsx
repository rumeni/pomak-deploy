import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, Card, FormError, LoadingScreen, ScreenHeader, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDecimal, getFormatLocale } from '../../lib/format'
import { formatCoachSet } from './formatCoach'
import { useRoutines } from '../training/api'
import { useAssignCoachRoutine, useCoachClient, useDisconnectCoach } from './api'
import { CoachMessages } from './CoachMessages'

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

export function CoachClientPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const { me } = useAuth()
  const client = useCoachClient(id)
  const routines = useRoutines()
  const assign = useAssignCoachRoutine(id ?? '')
  const disconnect = useDisconnectCoach()
  const [routineId, setRoutineId] = useState('')
  if (!me?.profile.is_coach) return <p className="p-6 text-danger">{t('coach.notAllowed')}</p>
  if (client.isLoading) return <LoadingScreen />
  if (client.isError || !client.data) return <p className="p-6 text-danger">{t('coach.clientNotFound')}</p>
  const data = client.data
  const availableRoutines = (routines.data ?? []).filter((routine) =>
    routine.exercises.length > 0 && routine.exercises.every((item) => !item.exercise.is_custom),
  )
  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={data.connection.client.name} onBack={() => navigate('/trener')} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <Card title={t('coach.overview')}>
          <p className="text-lg font-semibold">{t('coach.lastMonthWorkouts', { count: data.workouts_30d })}</p>
          <p className="mt-1 text-sm text-muted">{t('coach.sharedInformation')}</p>
        </Card>
        <Card title={t('coach.recentWorkouts')}>
          {data.recent_workouts.length === 0 && <p className="text-muted">{t('coach.noWorkouts')}</p>}
          {data.recent_workouts.map((w) => (
            <div key={w.id} className="border-b border-line py-2 last:border-0">
              <p className="font-semibold">{w.name}</p>
              <p className="text-sm text-muted">{dateLabel(w.started_at)}{w.feeling != null ? ` · ${t('coach.feeling', { value: w.feeling })}` : ''}</p>
              {w.exercises.map((item, index) => (
                <div key={`${item.name}-${index}`} className="mt-1 text-sm">
                  <span>{item.name}: </span>
                  <span className="text-muted">{item.sets.map((set) => formatCoachSet(set, `${t('routine.warmupShort')}:`, t('coach.reps'))).join(', ')}</span>
                </div>
              ))}
              {w.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{w.notes}</p>}
            </div>
          ))}
        </Card>
        <Card title={t('coach.goals')}>
          {data.goals.length === 0 && <p className="text-muted">{t('coach.noGoals')}</p>}
          {data.goals.map((goal) => (
            <p key={goal.kind} className="py-1 text-sm">{t(`coach.goalKinds.${goal.kind}` as const, { defaultValue: goal.kind })}: <strong>{formatDecimal(Number(goal.target_value))}</strong></p>
          ))}
        </Card>
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
        <Card title={t('coach.nutrition')}>
          {data.nutrition_days === null ? <p className="text-muted">{t('coach.notShared')}</p> : (
            data.nutrition_days.length === 0 ? <p className="text-muted">{t('coach.noNutrition')}</p> :
            data.nutrition_days.map((day) => (
              <p key={day.date} className="border-b border-line py-2 text-sm last:border-0">
                {day.date}: <strong>{Math.round(Number(day.kcal))} kcal</strong> · {t('coach.protein')} {day.protein_g === null ? '—' : formatDecimal(Number(day.protein_g))} g
              </p>
            ))
          )}
        </Card>
        <Card title={t('coach.assignRoutine')}>
          <p className="mb-3 text-sm text-muted">{t('coach.assignExplanation')}</p>
          {routines.isError && <FormError message={t('errors.loadFailed')} />}
          <label className="mb-1 block text-sm font-medium" htmlFor="coach-routine-select">{t('coach.selectRoutine')}</label>
          <select id="coach-routine-select" className={selectClass + ' w-full'} value={routineId} onChange={(e) => setRoutineId(e.target.value)}>
            <option value="">{t('coach.selectRoutine')}</option>
            {availableRoutines.map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
          </select>
          {availableRoutines.length === 0 && <p className="mt-2 text-sm text-muted">{t('coach.noSharedRoutines')}</p>}
          <FormError message={assign.error ? errorMessage(assign.error) : null} />
          <Button className="mt-3 w-full" disabled={!routineId || assign.isPending} onClick={() => assign.mutate(routineId, { onSuccess: () => setRoutineId('') })}>
            {t('coach.assign')}
          </Button>
          {assign.isSuccess && <p className="mt-2 text-sm text-brand-dark">{t('coach.assigned')}</p>}
          {data.assignments.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-sm font-semibold">{t('coach.assignedRoutines')}</p>
              {data.assignments.map((assignment) => (
                <p className="text-sm text-muted" key={assignment.id}>{assignment.name} · {dateLabel(assignment.assigned_at)}</p>
              ))}
            </div>
          )}
        </Card>
        <CoachMessages selfId={me.id} clientId={id} />
        <FormError message={disconnect.error ? errorMessage(disconnect.error) : null} />
        <Button variant="ghost" className="w-full text-danger" disabled={disconnect.isPending} onClick={() => {
          if (id && window.confirm(t('coach.removeClientConfirm'))) disconnect.mutate(id, { onSuccess: () => navigate('/trener', { replace: true }) })
        }}>{t('coach.removeClient')}</Button>
      </div>
    </div>
  )
}
