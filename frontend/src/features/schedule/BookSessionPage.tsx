import axios from 'axios'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, Card, Field, FormError, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useOnline } from '../../lib/useOnline'
import { uuid } from '../../lib/uuid'
import { useCreateBooking, useSlots, type Booking, type NewBooking } from './api'
import { ZoneNote } from './ZoneNote'
import { addDays, dayKey, dayLabel, groupByDay, timeLabel } from './time'

const PAGE_DAYS = 7

/** The client books a free time with his coach: a type, a day, a time. */
export function BookSessionPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const online = useOnline()
  const today = dayKey(new Date())
  const [from, setFrom] = useState(today)
  const [typeId, setTypeId] = useState<string | null>(null)
  const to = addDays(from, PAGE_DAYS - 1)
  const slots = useSlots(typeId, from, to)
  const data = slots.data
  const chosenType = data?.session_types.find((x) => x.id === data.session_type_id) ?? null
  const byDay = groupByDay(data?.slots ?? [], (s) => s)
  const days = Array.from({ length: PAGE_DAYS }, (_, i) => addDays(from, i))
  const [day, setDay] = useState<string | null>(null)
  const shownDay = day && days.includes(day) ? day : days.find((d) => byDay.has(d)) ?? days[0]
  const [slot, setSlot] = useState<string | null>(null)
  const [done, setDone] = useState<Booking | null>(null)
  const back = () => navigate('/trener')
  const noCoach = slots.isError && axios.isAxiosError(slots.error) && slots.error.response?.status === 404

  if (done) {
    return (
      <div className="min-h-full">
        <ScreenHeader title={t('schedule.book.title')} onBack={back} />
        <Card className="m-4 text-center">
          <p className="text-lg font-bold">{t(`schedule.book.outcome.${done.status}`)}</p>
          <p className="mt-1 capitalize">{dayLabel(dayKey(done.starts_at), true)}, {timeLabel(done.starts_at)}</p>
          <p className="text-sm text-muted">{done.session_type.name}</p>
          <Button className="mt-4 w-full" onClick={back}>{t('schedule.book.backToCoach')}</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={t('schedule.book.title')} onBack={back} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <ZoneNote />
        {!online && <p role="status" className="text-sm text-muted">{t('schedule.book.offline')}</p>}
        {slots.isLoading && <p className="text-muted">{t('common.loading')}</p>}
        {noCoach && <Card><p className="text-muted">{t('schedule.book.noCoach')}</p></Card>}
        {slots.isError && !noCoach && !data && (
          <Card>
            <FormError message={t('errors.loadFailed')} />
            <Button variant="secondary" className="mt-3" onClick={() => void slots.refetch()}>{t('common.retry')}</Button>
          </Card>
        )}
        {data && data.session_types.length === 0 && <Card><p className="text-muted">{t('schedule.book.noTypes')}</p></Card>}
        {data && data.session_types.length > 0 && (
          <>
            <Card title={t('schedule.type')}>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('schedule.type')}>
                {data.session_types.map((x) => (
                  <button key={x.id} type="button" role="radio" aria-checked={x.id === data.session_type_id}
                    onClick={() => { setTypeId(x.id); setSlot(null) }}
                    className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${x.id === data.session_type_id ? 'border-brand bg-brand text-white' : 'border-line bg-card'}`}>
                    {x.name} · {t('schedule.minutes', { count: x.duration_minutes })}
                  </button>
                ))}
              </div>
            </Card>
            <Card title={t('schedule.book.when')}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <Button size="sm" variant="secondary" disabled={from <= today} onClick={() => { setFrom(addDays(from, -PAGE_DAYS)); setSlot(null) }}
                  aria-label={t('schedule.calendar.previousWeek')}>‹</Button>
                <span className="text-sm font-semibold">{dayLabel(from)} – {dayLabel(to)}</span>
                <Button size="sm" variant="secondary" onClick={() => { setFrom(addDays(from, PAGE_DAYS)); setSlot(null) }}
                  aria-label={t('schedule.calendar.nextWeek')}>›</Button>
              </div>
              <div className="mb-3 grid grid-cols-7 gap-1">
                {days.map((d) => {
                  const count = byDay.get(d)?.length ?? 0
                  return (
                    <button key={d} type="button" disabled={!count} onClick={() => { setDay(d); setSlot(null) }} aria-pressed={d === shownDay}
                      className={`flex min-h-14 flex-col items-center justify-center rounded-xl text-xs ${d === shownDay ? 'bg-brand text-white' : count ? 'bg-brand-soft text-brand-dark' : 'bg-surface text-muted opacity-60'}`}>
                      <span className="capitalize">{dayLabel(d).split(',')[0]}</span>
                      <span className="text-sm font-bold">{Number(d.slice(8))}</span>
                    </button>
                  )
                })}
              </div>
              {(byDay.get(shownDay)?.length ?? 0) === 0
                ? <p className="text-sm text-muted">{t('schedule.book.noSlots')}</p>
                : (
                  <div className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4">
                    {byDay.get(shownDay)!.map((s) => (
                      <button key={s} type="button" onClick={() => setSlot(s)} aria-pressed={s === slot}
                        className={`min-h-11 rounded-xl border text-sm font-semibold tabular-nums ${s === slot ? 'border-brand bg-brand text-white' : 'border-line bg-card'}`}>
                        {timeLabel(s)}
                      </button>
                    ))}
                  </div>
                )}
            </Card>
            {slot && chosenType && (
              // Keyed by the collaboration too: a reconnect starts a fresh form, never a stale one.
              <ConfirmBooking key={`${data.connection_id}:${chosenType.id}:${slot}`} connectionId={data.connection_id}
                slot={slot} typeId={chosenType.id} typeName={chosenType.name}
                autoConfirm={data.auto_confirm} cancelHours={data.cancel_hours}
                onBooked={setDone} onTaken={() => { setSlot(null); void slots.refetch() }} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ConfirmBooking({ connectionId, slot, typeId, typeName, autoConfirm, cancelHours, onBooked, onTaken }: {
  connectionId: string
  slot: string
  typeId: string
  typeName: string
  autoConfirm: boolean
  cancelHours: number
  onBooked: (booking: Booking) => void
  onTaken: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateBooking()
  const [note, setNote] = useState('')
  // One ID for this choice: a retry after a lost answer returns the same booking.
  const [request, setRequest] = useState<NewBooking | null>(null)
  const submit = () => {
    const body = request && request.note === note.trim()
      ? request
      : { id: uuid(), session_type_id: typeId, starts_at: slot, note: note.trim(), connection_id: connectionId }
    setRequest(body)
    create.mutate(body, {
      onSuccess: onBooked,
      onError: (error) => {
        const code = axios.isAxiosError(error) ? (error.response?.data as { code?: string } | undefined)?.code : undefined
        // Taken meanwhile, or the collaboration changed: fresh slots (and a fresh form).
        if (code === 'slot_taken' || code === 'collaboration_changed') onTaken()
      },
    })
  }
  return (
    <Card title={t('schedule.book.confirmTitle')}>
      <p className="font-semibold capitalize">{dayLabel(dayKey(slot), true)}, {timeLabel(slot)}</p>
      <p className="mb-3 text-sm text-muted">{typeName}</p>
      <Field label={`${t('schedule.note')} (${t('common.optional')})`} name="booking-note" maxLength={300} value={note}
        placeholder={t('schedule.book.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
      <p className="mt-2 text-xs text-muted">
        {autoConfirm ? t('schedule.book.instant') : t('schedule.book.needsConfirmation')} {t('schedule.book.cancelRule', { count: cancelHours })}
      </p>
      <FormError message={create.error ? errorMessage(create.error) : null} />
      <Button className="mt-3 w-full" disabled={create.isPending} onClick={submit}>
        {create.isPending ? t('common.saving') : autoConfirm ? t('schedule.book.book') : t('schedule.book.request')}
      </Button>
    </Card>
  )
}
