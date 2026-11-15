import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { getFormatLocale } from '../../lib/format'
import { useCoachMessages, useSendCoachMessage } from './api'

export function CoachMessages({ selfId, clientId }: { selfId: string; clientId?: string }) {
  const { t } = useTranslation()
  const messages = useCoachMessages(clientId)
  const send = useSendCoachMessage(clientId)
  const [text, setText] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    send.mutate(text.trim(), { onSuccess: () => setText('') })
  }
  return (
    <Card title={t('coach.messages')}>
      <div aria-live="polite" className="mb-3 flex max-h-80 flex-col gap-2 overflow-y-auto rounded-xl border border-line p-3">
        {messages.isLoading && <p className="text-sm text-muted">{t('common.loading')}</p>}
        {messages.isError && <FormError message={t('errors.loadFailed')} />}
        {messages.data?.length === 0 && <p className="text-sm text-muted">{t('coach.noMessages')}</p>}
        {!messages.isError && messages.data?.map((message) => (
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
