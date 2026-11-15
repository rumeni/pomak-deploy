import axios from 'axios'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { db } from '../../lib/db'
import { getFormatLocale } from '../../lib/format'
import { useDeleteSession, useSession } from './api'
import { durationSeconds, formatWorkoutDuration, fromOutbox, fromServer, type SessionView } from './history'
import { StatusBadge } from './HistoryList'
import { describeLogged } from './model'
import { discardOutboxItem } from './outbox'
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
      if (!window.confirm(t('history.discardConfirm'))) return
      await discardOutboxItem(session.id)
      back()
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

        {session.status === 'pending' && <p className="rounded-xl bg-accent/15 px-4 py-3 text-sm">{t('history.pendingHint')}</p>}
        {session.status === 'rejected' && (
          <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{t('history.rejectedHint', { error: session.error })}</p>
        )}

        {session.exercises.map(({ exercise, sets }) => {
          // Radne serije 1, 2, 3…; zagrevanje ne ulazi u brojanje.
          const labels = sets.reduce<string[]>((acc, set) => {
            const done = acc.filter((l) => l !== warmup).length
            return [...acc, set.set_type === 'warmup' ? warmup : String(done + 1)]
          }, [])
          return (
            <section key={exercise.id} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60">
              <div className="flex">
                <ExerciseHeading exercise={exercise} />
              </div>
              <ol className="mt-2 flex flex-col gap-1">
                {sets.map((set, i) => (
                  <li key={i} className="flex gap-3 tabular-nums">
                    <span className="w-6 text-center font-semibold text-muted">{labels[i]}</span>
                    <span>{describeLogged(set, exercise, t('routine.phReps'))}</span>
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

        <FormError message={remove.isError ? errorMessage(remove.error) : null} />
        <Button variant="ghost" className="mt-4 text-danger" onClick={() => void onDelete()} disabled={remove.isPending}>
          {session.status === 'sent' ? t('history.delete') : t('history.discard')}
        </Button>
      </div>
    </div>
  )
}
