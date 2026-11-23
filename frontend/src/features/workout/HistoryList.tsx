import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '../../lib/auth'
import { getFormatLocale } from '../../lib/format'
import { useSessions } from './api'
import { combineHistory, durationSeconds, formatWorkoutDuration, fromOutbox, fromServer, setCount, type SessionView } from './history'
import { usePendingSessions } from './outbox'
import { saveHistory, useCachedHistory } from './historyCache'
import { useEffect } from 'react'

export function HistoryList() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { data, isLoading, isError, fetchStatus, hasNextPage, isFetchingNextPage, fetchNextPage } = useSessions(me?.id)
  const pending = usePendingSessions(me?.id)
  const cached = useCachedHistory(me?.id)

  // Every successful load refreshes the copy kept on the phone (the latest 30).
  const firstPage = data?.pages[0]
  useEffect(() => {
    if (me?.id && firstPage) void saveHistory(me.id, firstPage)
  }, [me?.id, firstPage])

  // No answer from the server (no internet, or an error): the copy on the phone instead.
  const offline = !data && !!cached?.length && (isError || fetchStatus === 'paused')
  // All fetched pages plus unsent local workouts; no duplicates after a sync.
  const sessions = data?.pages.flat() ?? (offline ? cached : [])
  const items = combineHistory(sessions.map(fromServer), (pending ?? []).map(fromOutbox))

  return (
    <section className="flex flex-col gap-2">
      <h2 className="mt-4 text-lg font-semibold">{t('history.title')}</h2>
      {offline ? (
        <p role="status" className="rounded-xl bg-surface px-3 py-2 text-sm text-muted">{t('history.offlineCopy', { count: cached.length })}</p>
      ) : (
        <>
          {isLoading && fetchStatus !== 'paused' && <p className="py-4 text-center text-muted">{t('common.loading')}</p>}
          {isError && <p className="py-2 text-center text-danger">{t('errors.loadFailed')}</p>}
        </>
      )}
      {!isLoading && !isError && items.length === 0 && <p className="py-2 text-muted">{t('history.empty')}</p>}
      {items.map((s) => (
        <HistoryItem key={s.id} session={s} />
      ))}
      {hasNextPage && (
        <button
          type="button"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
          className="min-h-12 rounded-xl bg-card px-4 font-semibold text-brand-dark ring-1 ring-line/60 disabled:opacity-50"
        >
          {t(isFetchingNextPage ? 'history.loadingMore' : 'history.loadMore')}
        </button>
      )}
    </section>
  )
}

function HistoryItem({ session: s }: { session: SessionView }) {
  const { t } = useTranslation()
  const date = new Date(s.startedAt).toLocaleDateString(getFormatLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <Link to={`/trening/istorija/${s.id}`} className="block rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60 active:bg-brand-soft">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{s.name || t('history.deleting')}</h3>
        {s.status !== 'sent' && <StatusBadge status={s.status} />}
      </div>
      <p className="text-sm text-muted">
        {t('history.meta', { date, duration: formatWorkoutDuration(durationSeconds(s), t) })} · {t('history.sets', { count: setCount(s) })}
      </p>
      <p className="mt-1 line-clamp-2 text-sm">{s.exercises.map((e) => e.exercise.name).join(', ')}</p>
    </Link>
  )
}

export function StatusBadge({ status }: { status: SessionView['status'] }) {
  const { t } = useTranslation()
  if (status === 'sent') return null
  const tone = status === 'pending' || status === 'deleting' ? 'bg-accent/20 text-ink' : 'bg-danger/15 text-danger'
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {status === 'pending' ? t('history.pending') : status === 'deleting' ? t('history.deleting') : t('history.rejected')}
    </span>
  )
}
