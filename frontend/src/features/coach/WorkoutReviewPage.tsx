import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, Card, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { formatDecimal, getFormatLocale } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { CoachMessages } from './CoachMessages'
import { isAccessRevoked } from './access'
import { useClientWorkout, useMarkReviewed, type ClientWorkout, type ReviewSet } from './reviewApi'
import { describePlannedSets } from './review'
import { readinessReasons } from './workspace'

/** One workout of a client: what was planned and what was done, then review and comment. */
export function WorkoutReviewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '', workoutId = '' } = useParams()
  const { me } = useAuth()
  const workout = useClientWorkout(id, workoutId)
  const reviewed = useMarkReviewed(id, workoutId)
  const back = () => navigate(`/trener/klijenti/${id}?tab=progress`)

  if (workout.isLoading) return <LoadingScreen />
  if (!workout.data || (workout.isError && isAccessRevoked(workout.error))) {
    return (
      <div className="min-h-full">
        <ScreenHeader title={t('coachSpace.review.title')} onBack={back} />
        <p className="p-6 text-center text-danger">{t('coachSpace.review.notFound')}</p>
      </div>
    )
  }
  const data = workout.data
  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={data.name} onBack={back} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <Card>
          <p className="text-sm text-muted">
            {new Date(data.started_at).toLocaleString(getFormatLocale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
            {' · '}{t('coachSpace.review.minutes', { count: Math.max(1, Math.round((new Date(data.finished_at).getTime() - new Date(data.started_at).getTime()) / 60000)) })}
            {data.feeling != null ? ` · ${t('coach.feeling', { value: data.feeling })}` : ''}
          </p>
          {data.edited_at && <p className="mt-1 text-xs text-muted">{t('coachSpace.review.edited')}</p>}
          {data.readiness?.score != null && (
            <p className="mt-2 text-sm">
              <strong>{t('readiness.score', { value: data.readiness.score })}</strong>
              {readinessReasons(data.readiness.answers).length > 0 && (
                <span className="text-muted"> · {readinessReasons(data.readiness.answers).map(({ field, value }) =>
                  field === 'sleep_hours' ? t('readiness.sleepValue', { value }) : `${t(`readiness.${field}`)} ${value}/5`).join(' · ')}</span>
              )}
            </p>
          )}
          {data.notes && <p className="mt-2 whitespace-pre-wrap text-sm">„{data.notes}“</p>}
          <div className="mt-3">
            {data.reviewed_at ? (
              <p className="text-sm font-semibold text-brand-dark">✓ {t('coachSpace.review.reviewed')}</p>
            ) : (
              <Button size="sm" disabled={reviewed.isPending} onClick={() => reviewed.mutate()}>{t('coachSpace.review.markReviewed')}</Button>
            )}
            <FormError message={reviewed.error ? errorMessage(reviewed.error) : null} />
          </div>
        </Card>
        <PlannedVsDone workout={data} />
        {me && (
          <CoachMessages selfId={me.id} clientId={id} workoutId={workoutId} title={t('coachSpace.review.comments')} />
        )}
      </div>
    </div>
  )
}

function doneSet(set: ReviewSet, t: (key: string) => string): string {
  const parts: string[] = []
  if (set.weight_kg != null) parts.push(`${formatDecimal(Number(set.weight_kg))} kg`)
  if (set.reps != null) parts.push(`× ${set.reps}`)
  if (set.duration_seconds != null) parts.push(`${Math.round(set.duration_seconds / 60 * 10) / 10} min`)
  if (set.distance_m != null) parts.push(`${formatDecimal(set.distance_m / 1000)} km`)
  if (set.rpe != null) parts.push(`@ ${formatDecimal(Number(set.rpe))}`)
  return `${set.set_type === 'warmup' ? `${t('routine.warmupShort')}: ` : ''}${parts.join(' ')}`
}

/** Per exercise: the planned sets (from the plan the workout started with) and the sets done. */
function PlannedVsDone({ workout }: { workout: ClientWorkout }) {
  const { t } = useTranslation()
  const planned = workout.plan?.exercises ?? []
  const doneIds = new Set(workout.exercises.map((e) => e.exercise_id))
  const skipped = planned.filter((p) => p.exercise?.id && !doneIds.has(p.exercise.id))
  return (
    <Card title={t('coachSpace.review.plannedVsDone')}>
      {!workout.plan && <p className="mb-2 text-sm text-muted">{t('coachSpace.review.noPlan')}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {workout.exercises.map((exercise) => {
          const plan = planned.find((p) => p.exercise?.id === exercise.exercise_id)
          return (
            <li key={exercise.exercise_id} className="py-2">
              <p className="font-semibold">{exercise.name}</p>
              {workout.plan && (
                <p className="text-sm text-muted">{t('coachSpace.review.planned')}: {plan ? describePlannedSets(plan.sets ?? [], t) : t('coachSpace.review.extra')}</p>
              )}
              <p className="text-sm">{t('coachSpace.review.done')}: {exercise.sets.map((s) => doneSet(s, t)).join(', ')}</p>
              {exercise.notes && <p className="text-xs text-muted">„{exercise.notes}“</p>}
            </li>
          )
        })}
        {skipped.map((p, i) => (
          <li key={`skipped-${i}`} className="py-2">
            <p className="font-semibold">{p.exercise?.name ?? '?'}</p>
            <p className="text-sm text-muted">{t('coachSpace.review.planned')}: {describePlannedSets(p.sets ?? [], t)}</p>
            <p className="text-sm text-danger">{t('coachSpace.review.skipped')}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
