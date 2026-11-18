import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { getFormatLocale } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { useCoachMessages, useSendCoachMessage } from './api'
import { useMarkRead } from './inboxApi'
import { mergeCoachMessagePages } from './messages'
import { planDate } from './plans'
import { chatScrollTop, nearChatBottom } from './chatScroll'

/**
 * One conversation. `connectionId` addresses any of the user's conversations (an ended one is a
 * read-only archive: no polling, no input); otherwise the active one with `clientId` (coach) or
 * the client's own.
 */
export function CoachMessages({ selfId, clientId, connectionId, workoutId, weekStart, readOnly = false, title, workoutLink, weekLink }: {
  selfId: string
  clientId?: string
  connectionId?: string
  /** Only the comments on this workout; new messages are comments on it. */
  workoutId?: string
  /** Only the comments on this week (its Monday); new messages are comments on it. */
  weekStart?: string
  readOnly?: boolean
  title?: string
  /** Where a comment's workout opens (the coach's review or the client's history); none: no link. */
  workoutLink?: (workoutId: string) => string
  /** Where a comment's week opens; none: no link. */
  weekLink?: (weekStart: string) => string
}) {
  const { t } = useTranslation()
  const target = { clientId, connectionId, workoutId, weekStart }
  const messages = useCoachMessages(target, { live: !readOnly })
  const send = useSendCoachMessage(target)
  const [text, setText] = useState('')
  // Preserve the same ID across a lost response and a manual retry.
  const pendingMessage = useRef<{ id: string; text: string } | null>(null)
  const items = mergeCoachMessagePages(messages.data?.pages ?? [])
  const newestId = items.at(-1)?.id ?? null
  const listRef = useRef<HTMLDivElement>(null)
  const restoreScroll = useRef<{ top: number; height: number } | null>(null)
  const previousCount = useRef(0)
  const previousNewestId = useRef<string | null>(null)
  const readerNearBottom = useRef(true)
  const conversationKey = `${selfId}:${connectionId ?? clientId ?? 'own'}:${workoutId ?? ''}:${weekStart ?? ''}`
  const lastConversation = useRef(conversationKey)

  // Initial load shows the newest chat message. Polling follows new messages
  // only when the reader was already near the bottom. Loading older pages
  // preserves the reader's original position, even across a refetch.
  useLayoutEffect(() => {
    if (lastConversation.current !== conversationKey) {
      lastConversation.current = conversationKey
      // A lost-response retry belongs to its original workout/week, never to a new conversation.
      pendingMessage.current = null
      setText('')
      previousCount.current = 0
      previousNewestId.current = null
      readerNearBottom.current = true
      restoreScroll.current = null
    }
    const box = listRef.current
    if (!box) return
    const target = chatScrollTop({
      previousCount: previousCount.current,
      count: items.length,
      previousNewestId: previousNewestId.current,
      newestId,
      nearBottom: readerNearBottom.current,
      scrollHeight: box.scrollHeight,
      restore: restoreScroll.current,
    })
    if (target !== null) box.scrollTop = target
    previousCount.current = items.length
    previousNewestId.current = newestId
    restoreScroll.current = null
  }, [items.length, messages.data, conversationKey, newestId])

  // The whole conversation is on screen (not only a workout's or a week's comments): what the
  // other side wrote up to the newest message is read, once the app is actually visible.
  const markRead = useMarkRead()
  const markedId = useRef<string | null>(null)
  const newestFromOther = items.length > 0 && items.some((m) => m.sender_id !== selfId)
  const fullConversation = !workoutId && !weekStart
  useEffect(() => {
    if (!fullConversation || !newestId || !newestFromOther) return
    const mark = () => {
      if (document.visibilityState !== 'visible' || markedId.current === newestId) return
      markedId.current = newestId
      markRead.mutate(newestId)
    }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
    // markRead is a stable mutation object; only the newest message matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, fullConversation, newestFromOther])

  const loadOlder = () => {
    const box = listRef.current
    if (box) restoreScroll.current = { top: box.scrollTop, height: box.scrollHeight }
    void messages.fetchNextPage()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (!message || send.isPending) return
    const body = pendingMessage.current?.text === message
      ? pendingMessage.current
      : { id: uuid(), text: message }
    pendingMessage.current = body
    send.mutate(body, {
      onSuccess: () => {
        // An old request may finish after navigation; don't clear the new conversation's draft.
        if (pendingMessage.current?.id !== body.id) return
        pendingMessage.current = null
        setText((current) => current.trim() === message ? '' : current)
      },
    })
  }
  return (
    <Card title={title ?? t('coach.messages')}>
      <div
        ref={listRef}
        aria-live="polite"
        onScroll={(event) => {
          const box = event.currentTarget
          readerNearBottom.current = nearChatBottom(box.scrollTop, box.clientHeight, box.scrollHeight)
        }}
        className="mb-3 flex max-h-80 flex-col gap-2 overflow-y-auto rounded-xl border border-line p-3"
      >
        {messages.isLoading && <p className="text-sm text-muted">{t('common.loading')}</p>}
        {messages.isError && <FormError message={t('errors.loadFailed')} />}
        {messages.hasNextPage && (
          <Button variant="secondary" disabled={messages.isFetchingNextPage} onClick={loadOlder}>
            {t(messages.isFetchingNextPage ? 'coach.loadingOlderMessages' : 'coach.loadOlderMessages')}
          </Button>
        )}
        {messages.data && items.length === 0 && <p className="text-sm text-muted">{t('coach.noMessages')}</p>}
        {items.map((message) => (
          <div key={message.id} className={`max-w-[90%] rounded-xl px-3 py-2 ${message.sender_id === selfId ? 'self-end bg-brand-soft' : 'self-start bg-surface'}`}>
            {message.workout && !workoutId && (
              workoutLink
                ? <Link to={workoutLink(message.workout.id)} className="mb-1 block text-xs font-semibold underline">{t('coachSpace.review.aboutWorkout', { name: message.workout.name })}</Link>
                : <p className="mb-1 text-xs font-semibold">{t('coachSpace.review.aboutWorkout', { name: message.workout.name })}</p>
            )}
            {message.week_start && !weekStart && (
              weekLink
                ? <Link to={weekLink(message.week_start)} className="mb-1 block text-xs font-semibold underline">{t('coachSpace.week.aboutWeek', { date: planDate(message.week_start) })}</Link>
                : <p className="mb-1 text-xs font-semibold">{t('coachSpace.week.aboutWeek', { date: planDate(message.week_start) })}</p>
            )}
            <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
            <p className="mt-1 text-right text-xs text-muted">
              {new Date(message.created_at).toLocaleString(getFormatLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>
      {readOnly ? <p className="text-sm text-muted">{t('coachSpace.archiveReadOnly')}</p> : (
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <label htmlFor="coach-message" className="text-sm font-medium">{t('coach.newMessage')}</label>
        <textarea id="coach-message" value={text} onChange={(e) => setText(e.target.value)} maxLength={800} rows={3} className="w-full rounded-xl border border-line bg-card p-3 outline-none focus:border-brand" placeholder={t('coach.messagePlaceholder')} />
        <FormError message={send.error ? errorMessage(send.error) : null} />
        <Button disabled={send.isPending || !text.trim()}>{t('coach.sendMessage')}</Button>
      </form>
      )}
    </Card>
  )
}
