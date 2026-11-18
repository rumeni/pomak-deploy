import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { getFormatLocale } from '../../lib/format'
import { useCoachDashboard, type ClientRow, type Connection } from './api'
import { ClientDetail } from './ClientDetail'
import { InviteSheet } from './InviteSheet'
import { CoachHeader } from './SpaceSwitch'
import { daysSince } from './tasks'
import { Avatar } from './Avatar'
import { matchesSearch } from './workspace'

type Filter = 'active' | 'paused' | 'invited' | 'archived'

/**
 * Clients: search and status, invitations. On a wide screen the selected client opens next to
 * the list (two columns); on a phone it is its own screen.
 */
export function CoachClientsPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const dashboard = useCoachDashboard()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('active')
  const [inviting, setInviting] = useState(false)
  const data = dashboard.data?.role === 'coach' ? dashboard.data : null

  const list = (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('coachSpace.clients.search')}
          aria-label={t('coachSpace.clients.search')}
          className="app-input min-h-12 min-w-0 flex-1 rounded-2xl border border-line bg-card px-4 outline-none focus:border-brand"
        />
        <Button onClick={() => setInviting(true)} disabled={!data}>{t('coachSpace.clients.invite')}</Button>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('coachSpace.clients.statusFilter')}>
        {(['active', 'paused', 'invited', 'archived'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold ${filter === value ? 'border-brand bg-brand text-white' : 'border-line bg-card'}`}
          >
            {t(`coachSpace.clients.filters.${value}`)}{data ? ` · ${count(data, value)}` : ''}
          </button>
        ))}
      </div>
      {dashboard.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {dashboard.isError && !data && (
        <Card>
          <FormError message={t('errors.loadFailed')} />
          <Button variant="secondary" className="mt-3" onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button>
        </Card>
      )}
      {data && <ClientList data={data} filter={filter} query={query} selectedId={id} onInvite={() => setInviting(true)} />}
    </div>
  )

  return (
    <>
      <div className={id ? 'max-[979px]:hidden' : ''}>
        <CoachHeader title={t('coachSpace.clients.title')} />
      </div>
      <div className={`px-4 pb-8 ${id ? 'min-[980px]:grid min-[980px]:grid-cols-[300px_minmax(0,1fr)] min-[980px]:items-start min-[980px]:gap-6' : ''}`}>
        <div className={id ? 'max-[979px]:hidden min-[980px]:sticky min-[980px]:top-4' : ''}>{list}</div>
        {id && <ClientDetail key={id} clientId={id} />}
      </div>
      {inviting && data && <InviteSheet invitations={data.invitations} onClose={() => setInviting(false)} />}
    </>
  )
}

type CoachData = Extract<NonNullable<ReturnType<typeof useCoachDashboard>['data']>, { role: 'coach' }>

function count(data: CoachData, filter: Filter): number {
  if (filter === 'invited') return data.invitations.length
  if (filter === 'archived') return data.archived_clients?.length ?? 0
  return data.clients.filter((c) => (c.status === 'paused') === (filter === 'paused')).length
}

function ClientList({ data, filter, query, selectedId, onInvite }: {
  data: CoachData
  filter: Filter
  query: string
  selectedId?: string
  onInvite: () => void
}) {
  const { t } = useTranslation()
  if (filter === 'invited') {
    const rows = data.invitations.filter((i) => matchesSearch(i.label || '', query))
    if (!rows.length) return <Empty text={t('coachSpace.clients.noInvited')} action={<Button variant="secondary" onClick={onInvite}>{t('coachSpace.clients.invite')}</Button>} />
    return (
      <ul className="flex flex-col gap-2">
        {rows.map((invite) => (
          <li key={invite.id}>
            <button type="button" onClick={onInvite} className="app-card flex w-full items-center gap-3 !p-3 text-left">
              <Avatar name={invite.label || '?'} muted />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{invite.label || t('coachSpace.invite.unnamed')}</span>
                <span className="block text-xs text-muted">{t('coachSpace.clients.invitedStatus')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }
  if (filter === 'archived') {
    const rows = (data.archived_clients ?? []).filter((c) => matchesSearch(c.client.name, query))
    if (!rows.length) return <Empty text={t('coachSpace.clients.noArchived')} />
    return (
      <ul className="flex flex-col gap-2">
        {rows.map((c) => <ArchivedRow key={c.id} connection={c} />)}
      </ul>
    )
  }
  const rows = data.clients
    .filter((c) => (c.status === 'paused') === (filter === 'paused'))
    .filter((c) => matchesSearch(c.client.name, query))
  if (!rows.length) {
    return data.clients.length === 0 && filter === 'active'
      ? <Empty text={t('coach.noClients')} action={<Button onClick={onInvite}>{t('coachSpace.clients.invite')}</Button>} />
      : <Empty text={t(query ? 'coachSpace.clients.noMatch' : 'coachSpace.clients.nonePaused')} />
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((c) => <ClientItem key={c.id} row={c} selected={c.client.id === selectedId} />)}
    </ul>
  )
}

function ClientItem({ row, selected }: { row: ClientRow; selected: boolean }) {
  const { t } = useTranslation()
  const last = row.last_workout_at
  const lastText = !last ? t('coachSpace.task.noWorkoutYet')
    : daysSince(last, new Date()) === 0 ? t('coachSpace.clients.trainedToday')
      : t('coachSpace.clients.lastWorkout', { count: daysSince(last, new Date()) })
  return (
    <li>
      <Link
        to={`/trener/klijenti/${row.client.id}`}
        aria-current={selected ? 'page' : undefined}
        className={`app-card flex items-center gap-3 !p-3 ${selected ? 'ring-2 ring-brand' : ''}`}
      >
        <Avatar name={row.client.name} muted={row.status === 'paused'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{row.client.name}</span>
          <span className="block text-xs text-muted">
            {row.status === 'paused' ? t('coachSpace.clients.pausedStatus') : `${lastText} · ${t('coachSpace.clients.thisWeek', { count: row.workouts_7d })}`}
          </span>
        </span>
        {!!row.unread_messages && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-dark" aria-label={t('coach.unread', { count: row.unread_messages })}>
            ✉ {row.unread_messages}
          </span>
        )}
        {row.open_tasks > 0 && (
          <span className="min-w-7 rounded-full bg-accent px-2 py-0.5 text-center text-xs font-bold text-white" aria-label={t('coachSpace.clients.openTasks', { count: row.open_tasks })}>
            {row.open_tasks}
          </span>
        )}
      </Link>
    </li>
  )
}

function ArchivedRow({ connection }: { connection: Connection }) {
  const { t } = useTranslation()
  return (
    <li>
      <Link to={`/trener/arhiva/${connection.id}`} className="app-card flex items-center gap-3 !p-3">
        <Avatar name={connection.client.name} muted />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{connection.client.name}</span>
          <span className="block text-xs text-muted">
            {t('coachSpace.clients.endedOn', { date: connection.ended_at ? new Date(connection.ended_at).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '' })}
          </span>
        </span>
      </Link>
    </li>
  )
}

function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <Card className="text-center">
      <p className="text-muted">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}
