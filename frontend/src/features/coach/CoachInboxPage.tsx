import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { getFormatLocale } from '../../lib/format'
import { useConversations, type Conversation } from './api'
import { Avatar } from './Avatar'
import { CoachMessages } from './CoachMessages'
import { NotesPanel } from './ClientDetail'
import { CoachHeader } from './SpaceSwitch'

function otherName(c: Conversation | { coach: { id: string; name: string }; client: { name: string } }, selfId: string) {
  return c.coach.id === selfId ? c.client.name : c.coach.name
}

/** All conversations: active ones first, then archived (read-only). Two columns on a wide screen. */
export function CoachInboxPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { me } = useAuth()
  const conversations = useConversations()
  const rows = conversations.data ?? []
  const active = rows.filter((c) => c.status !== 'ended')
  const archived = rows.filter((c) => c.status === 'ended')
  const selected = rows.find((c) => c.id === id)

  const list = (
    <div className="flex flex-col gap-3">
      {conversations.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {conversations.isError && !conversations.data && (
        <Card>
          <FormError message={t('errors.loadFailed')} />
          <Button variant="secondary" className="mt-3" onClick={() => void conversations.refetch()}>{t('common.retry')}</Button>
        </Card>
      )}
      {conversations.data && rows.length === 0 && <Card className="text-center"><p className="text-muted">{t('coachSpace.inbox.empty')}</p></Card>}
      {active.length > 0 && <ConversationList rows={active} selectedId={id} selfId={me?.id ?? ''} />}
      {archived.length > 0 && (
        <>
          <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('coachSpace.inbox.archived')}</h2>
          <ConversationList rows={archived} selectedId={id} selfId={me?.id ?? ''} />
        </>
      )}
    </div>
  )

  return (
    <>
      <div className={id ? 'max-[979px]:hidden' : ''}>
        <CoachHeader title={t('coachSpace.inbox.title')} />
      </div>
      <div className={`px-4 pb-8 ${id ? 'min-[980px]:grid min-[980px]:grid-cols-[300px_minmax(0,1fr)] min-[980px]:items-start min-[980px]:gap-6' : ''}`}>
        <div className={id ? 'max-[979px]:hidden' : ''}>{list}</div>
        {id && me && (
          selected ? <ConversationView key={selected.id} conversation={selected} selfId={me.id} />
            : conversations.data ? <Card><p className="text-muted">{t('coachSpace.inbox.notFound')}</p></Card>
              : null
        )}
      </div>
    </>
  )
}

function ConversationList({ rows, selectedId, selfId }: { rows: Conversation[]; selectedId?: string; selfId: string }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((c) => {
        const name = otherName(c, selfId)
        const last = c.last_message
        return (
          <li key={c.id}>
            <Link to={`/trener/poruke/${c.id}`} aria-current={c.id === selectedId ? 'page' : undefined}
              className={`app-card flex items-center gap-3 !p-3 ${c.id === selectedId ? 'ring-2 ring-brand' : ''}`}>
              <Avatar name={name} muted={c.status === 'ended'} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{name}</span>
                  {last && <span className="shrink-0 text-xs text-muted">{new Date(last.created_at).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short' })}</span>}
                </span>
                <span className={`block truncate text-sm ${c.unread ? 'font-semibold text-ink' : 'text-muted'}`}>
                  {last ? `${last.sender_id === selfId ? `${t('coachSpace.inbox.you')}: ` : ''}${last.text}` : t('coach.noMessages')}
                </span>
              </span>
              {!!c.unread && (
                <span className="min-w-7 rounded-full bg-accent px-2 py-0.5 text-center text-xs font-bold text-white" aria-label={t('coach.unread', { count: c.unread })}>
                  {c.unread}
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function ConversationView({ conversation, selfId }: { conversation: Conversation; selfId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const ended = conversation.status === 'ended'
  const name = otherName(conversation, selfId)
  const isCoach = conversation.coach.id === selfId
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={name}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate('/trener/poruke')} aria-label={t('common.back')} className="flex size-11 items-center justify-center rounded-full active:bg-line min-[980px]:hidden">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">{name}</h1>
        {isCoach && !ended && <Link to={`/trener/klijenti/${conversation.client.id}`} className="text-sm font-semibold underline">{t('coachSpace.inbox.openClient')}</Link>}
      </div>
      {ended && <p className="text-sm text-muted">{t('coachSpace.archive.endedNotice', { date: conversation.ended_at ? new Date(conversation.ended_at).toLocaleDateString(getFormatLocale()) : '' })}</p>}
      <CoachMessages
        selfId={selfId} connectionId={conversation.id} readOnly={ended}
        workoutLink={ended ? undefined : isCoach ? (w) => `/trener/klijenti/${conversation.client.id}/trening/${w}` : (w) => `/trening/istorija/${w}`}
        weekLink={ended ? undefined : isCoach ? (w) => `/trener/klijenti/${conversation.client.id}/nedelja?od=${w}` : (w) => `/napredak/nedelja?od=${w}`}
      />
    </section>
  )
}

/**
 * An ended collaboration, for either side: the conversation (read-only) and the notes - all of
 * the coach's own for the coach, only the shared ones for the client.
 */
export function ArchivePage() {
  const { t } = useTranslation()
  const { connectionId } = useParams()
  const { me } = useAuth()
  const navigate = useNavigate()
  const conversations = useConversations()
  const conversation = conversations.data?.find((c) => c.id === connectionId)
  if (!me || !connectionId) return null
  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate(-1)} aria-label={t('common.back')} className="flex size-11 items-center justify-center rounded-full active:bg-line">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">
          {conversation ? otherName(conversation, me.id) : t('coachSpace.archive.title')}
        </h1>
      </div>
      {conversations.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {conversations.data && !conversation && <Card><p className="text-muted">{t('coachSpace.inbox.notFound')}</p></Card>}
      {conversation && (
        <>
          <p className="text-sm text-muted">
            {conversation.status === 'ended'
              ? t('coachSpace.archive.endedNotice', { date: conversation.ended_at ? new Date(conversation.ended_at).toLocaleDateString(getFormatLocale()) : '' })
              : t('coachSpace.archive.stillActive')}
          </p>
          <CoachMessages selfId={me.id} connectionId={conversation.id} readOnly={conversation.status === 'ended'} />
          <NotesPanel connectionId={conversation.id} readOnly />
        </>
      )}
    </div>
  )
}
