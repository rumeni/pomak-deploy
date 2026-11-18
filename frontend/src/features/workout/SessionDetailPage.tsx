import axios from 'axios'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { WorkoutCoachComments } from '../coach/WorkoutCoachComments'
import { useAuth } from '../../lib/auth'
import { db } from '../../lib/db'
import { getFormatLocale } from '../../lib/format'
import { useDeleteSession, useSession } from './api'
import { durationSeconds, formatWorkoutDuration, fromOutbox, fromServer, sessionExerciseKey, type SessionView } from './history'
import { StatusBadge } from './HistoryList'
import { describeLogged } from './model'
import { ReadinessSummary } from './ReadinessSummary'
import { discardOutboxItem, restoreRejectedWorkout } from './outbox'
import { requestSync } from './sync'
import { ExerciseHeading } from '../training/ExerciseHeading'

/** Detalj treninga iz istorije: sa servera ili, dok nije poslat, sa telefona. */
export function SessionDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { me } = useAuth()

  const local = useLiveQuery(async () => {
    const row = id ? await db.outbox.get(id) : undefined
    return row && row.ownerId === me?.id ? row : null
  }, [id, me?.id])
  const remote = useSession(id, local === null)
  const remove = useDeleteSession()
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState<string | null>(null)

  const session: SessionView | null = local ? fromOutbox(local) : remote.data ? fromServer(remote.data) : null
  const back = () => navigate('/trening')

  if (local === undefined || (local === null && remote.isLoading)) {
    return <LoadingScreen />
  }
  if (!session) {
    return (
      <>
        <ScreenHeader title={t('history.title')} onBack={back} />
        <p className="p-6 text-center text-danger">
          {axios.isAxiosError(remote.error) && !remote.error.response ? t('errors.noConnection') : t('history.notFound')}
        </p>
      </>
    )
  }

  const onDelete = async () => {
    if (session.status === 'sent') {
      if (!window.confirm(t('history.deleteConfirm', { name: session.name }))) return
      remove.mutate(session.id, { onSuccess: back })
    } else {
      if (!me) return
      if (session.status !== 'deleting' && !window.confirm(t('history.discardConfirm'))) return
      setDiscardError(null)
      setDiscarding(true)
      try {
        await discardOutboxItem(me.id, session.id)
        requestSync()
        back()
      } catch (cause) {
        setDiscardError(errorMessage(cause))
        setDiscarding(false)
      }
    }
  }

  const onRestore = async () => {
    if (!local || !me) return
    setRestoreError(null)
    setRestoring(true)
    try {
      await restoreRejectedWorkout(me.id, local.id)
      navigate('/trening/aktivan', { replace: true })
    } catch (cause) {
      setRestoreError(t(cause instanceof Error && cause.message === 'ACTIVE_WORKOUT_EXISTS'
        ? 'history.restoreActiveFirst' : 'history.restoreFailed'))
      setRestoring(false)
    }
  }

  const warmup = t('routine.warmupShort')
  const date = new Date(session.startedAt).toLocaleString(getFormatLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={session.name} onBack={back} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-muted">
            {date} · {formatWorkoutDuration(durationSeconds(session), t)}
          </p>
          <StatusBadge status={session.status} />
        </div>

        {remote.data?.edited_at && session.status === 'sent' && (
          <p className="text-sm text-muted">
            {t('history.edit.edited', {
              date: new Date(remote.data.edited_at).toLocaleString(getFormatLocale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
            })}
          </p>
        )}
        {session.status === 'pending' && <p className="rounded-xl bg-accent/15 px-4 py-3 text-sm">{t('history.pendingHint')} {t('history.edit.pendingHint')}</p>}
        {session.status === 'deleting' && <p className="rounded-xl bg-accent/15 px-4 py-3 text-sm">{t('history.deletingHint')}</p>}
        {session.status === 'rejected' && (
          <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{t('history.rejectedHint', { error: session.error })}</p>
        )}

        {session.readiness && <ReadinessSummary readiness={session.readiness} />}

        {session.exercises.map(({ exercise, notes, sets }, position) => {
          // Radne serije 1, 2, 3…; zagrevanje ne ulazi u brojanje.
          const labels = sets.reduce<string[]>((acc, set) => {
            const done = acc.filter((l) => l !== warmup).length
            return [...acc, set.set_type === 'warmup' ? warmup : String(done + 1)]
          }, [])
          return (
            <section key={sessionExerciseKey(exercise.id, position)} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60">
              <div className="flex">
                <ExerciseHeading exercise={exercise} />
              </div>
              {notes && <p className="mt-2 whitespace-pre-line rounded-lg bg-surface px-3 py-2 text-sm">{notes}</p>}
              <ol className="mt-2 flex flex-col gap-1">
                {sets.map((set, i) => (
                  <li key={i} className="flex gap-3 tabular-nums">
                    <span className="w-6 text-center font-semibold text-muted">{labels[i]}</span>
                    <span>{describeLogged(set, exercise, t('routine.phReps'), true)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )
        })}

        {session.feeling && (
          <p>
            <span className="font-medium">{t('history.feeling')}:</span> {t(`workout.feeling${session.feeling}`)}
          </p>
        )}
        {session.notes && (
          <p className="whitespace-pre-line">
            <span className="font-medium">{t('history.notes')}:</span> {session.notes}
          </p>
        )}

        {session.status === 'sent' && me && !me.profile.is_coach && <WorkoutCoachComments workoutId={session.id} selfId={me.id} />}

        <FormError message={restoreError ?? discardError ?? (remove.isError ? errorMessage(remove.error) : null)} />
        {session.status === 'sent' && (
          <Button variant="secondary" onClick={() => navigate(`/trening/istorija/${session.id}/izmena`)} disabled={!navigator.onLine}>
            {t('history.edit.button')}
          </Button>
        )}
        {session.status === 'sent' && !navigator.onLine && <p className="text-center text-sm text-muted">{t('history.edit.onlineOnly')}</p>}
        {session.status === 'rejected' && local && (
          <Button onClick={() => void onRestore()} disabled={restoring}>
            {t('history.restoreToEdit')}
          </Button>
        )}
        <Button variant="ghost" className="mt-4 text-danger" onClick={() => void onDelete()} disabled={remove.isPending || discarding}>
          {session.status === 'sent' ? t('history.delete') : session.status === 'deleting' ? t('history.retryDelete') : t('history.discard')}
        </Button>
      </div>
    </div>
  )
}
