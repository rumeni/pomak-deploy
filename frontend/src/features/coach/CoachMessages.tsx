import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { getFormatLocale } from '../../lib/format'
import { useCoachMessages, useSendCoachMessage } from './api'
import { mergeCoachMessagePages } from './messages'

export function CoachMessages({ selfId, clientId }: { selfId: string; clientId?: string }) {
  const { t } = useTranslation()
  const messages = useCoachMessages(clientId)
  const send = useSendCoachMessage(clientId)
  const [text, setText] = useState('')
  const items = mergeCoachMessagePages(messages.data?.pages ?? [])
  const listRef = useRef<HTMLDivElement>(null)
  const restoreScroll = useRef<{ top: number; height: number } | null>(null)

  // Loading older messages prepends content; keep the message the user was
  // reading in place rather than jumping to the newly inserted top.
  useLayoutEffect(() => {
    const box = listRef.current
    const old = restoreScroll.current
    if (!box || !old) return
    box.scrollTop = old.top + box.scrollHeight - old.height
    restoreScroll.current = null
  }, [items.length])

  const loadOlder = () => {
    const box = listRef.current
    if (box) restoreScroll.current = { top: box.scrollTop, height: box.scrollHeight }
    void messages.fetchNextPage()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    send.mutate(text.trim(), { onSuccess: () => setText('') })
  }
  return (
    <Card title={t('coach.messages')}>
      <div ref={listRef} aria-live="polite" className="mb-3 flex max-h-80 flex-col gap-2 overflow-y-auto rounded-xl border border-line p-3">
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
            <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
            <p className="mt-1 text-right text-xs text-muted">
              {new Date(message.created_at).toLocaleString(getFormatLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <label htmlFor="coach-message" className="text-sm font-medium">{t('coach.newMessage')}</label>
        <textarea id="coach-message" value={text} onChange={(e) => setText(e.target.value)} maxLength={800} rows={3} className="w-full rounded-xl border border-line bg-card p-3 outline-none focus:border-brand" placeholder={t('coach.messagePlaceholder')} />
        <FormError message={send.error ? errorMessage(send.error) : null} />
        <Button disabled={send.isPending || !text.trim()}>{t('coach.sendMessage')}</Button>
      </form>
    </Card>
  )
}
