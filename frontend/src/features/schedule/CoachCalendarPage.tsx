import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, Field, FormError, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { uuid } from '../../lib/uuid'
import { useCoachDashboard } from '../coach/api'
import { CoachHeader } from '../coach/SpaceSwitch'
import { useBookingAction, useCalendar, useCreateBooking, useSessionTypes, type Booking, type NewBooking } from './api'
import { BookingStatusChip } from './BookingStatusChip'
import { addDays, dayKey, dayLabel, groupByDay, localMoment, mondayOf, timeLabel, weekDays } from './time'

/** The coach's week: sessions, requests to answer, closed and extra time. */
export function CoachCalendarPage() {
  const { t } = useTranslation()
  const today = dayKey(new Date())
  const [monday, setMonday] = useState(() => mondayOf(today))
  const days = weekDays(monday)
  const calendar = useCalendar(days[0], days[6])
  const byDay = groupByDay(calendar.data?.bookings ?? [], (b) => b.starts_at)
  const exceptionsByDay = groupByDay(calendar.data?.exceptions ?? [], (e) => e.starts_at)
  const [adding, setAdding] = useState(false)

  return (
    <>
      <CoachHeader title={t('schedule.calendar.title')} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMonday(addDays(monday, -7))} aria-label={t('schedule.calendar.previousWeek')}>‹</Button>
          <Button size="sm" variant="secondary" onClick={() => setMonday(mondayOf(today))}>{t('schedule.calendar.thisWeek')}</Button>
          <Button size="sm" variant="secondary" onClick={() => setMonday(addDays(monday, 7))} aria-label={t('schedule.calendar.nextWeek')}>›</Button>
          <span className="text-sm font-semibold">{dayLabel(days[0])} – {dayLabel(days[6])}</span>
          <span className="flex-1" />
          <Link to="/trener/kalendar/podesavanja" className="app-button inline-flex min-h-10 items-center bg-brand-soft px-4 text-sm text-brand-dark">
            {t('schedule.calendar.settings')}
          </Link>
          <Button size="sm" onClick={() => setAdding((v) => !v)}>{t('schedule.calendar.newBooking')}</Button>
        </div>

        {!!calendar.data?.requests && (
          <p role="status" className="rounded-xl bg-accent/15 px-4 py-3 text-sm font-semibold">
            {t('schedule.calendar.requests', { count: calendar.data.requests })}
          </p>
        )}
        {adding && <CoachBookingForm defaultDay={days.includes(today) ? today : days[0]} onDone={() => setAdding(false)} />}
        {calendar.isLoading && <p className="text-muted">{t('common.loading')}</p>}
        {calendar.isError && !calendar.data && (
          <Card>
            <FormError message={t('errors.loadFailed')} />
            <Button variant="secondary" className="mt-3" onClick={() => void calendar.refetch()}>{t('common.retry')}</Button>
          </Card>
        )}
        {calendar.data && days.map((day) => {
          const items = byDay.get(day) ?? []
          const exceptions = exceptionsByDay.get(day) ?? []
          return (
            <section key={day} aria-label={dayLabel(day, true)} className={`app-card !p-3 ${day === today ? 'ring-2 ring-brand' : ''}`}>
              <h2 className="mb-2 text-sm font-bold capitalize">{dayLabel(day, true)}</h2>
              {exceptions.map((e) => (
                <p key={e.id} className={`mb-2 rounded-lg px-3 py-1.5 text-xs font-semibold ${e.kind === 'closed' ? 'bg-line text-muted' : 'bg-brand-soft text-brand-dark'}`}>
                  {e.kind === 'closed' ? t('schedule.exceptions.closed') : t('schedule.exceptions.open')}: {timeLabel(e.starts_at)}–{timeLabel(e.ends_at)}{e.note ? ` · ${e.note}` : ''}
                </p>
              ))}
              {items.length === 0 && <p className="text-sm text-muted">{t('schedule.calendar.free')}</p>}
              <ul className="flex flex-col gap-2">
                {items.map((b) => <CoachBookingRow key={b.id} booking={b} />)}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}

function CoachBookingRow({ booking }: { booking: Booking }) {
  const { t } = useTranslation()
  const action = useBookingAction()
  const run = (kind: 'confirm' | 'decline' | 'cancel') => {
    let reason = ''
    if (kind !== 'confirm') {
      const answer = window.prompt(t(kind === 'decline' ? 'schedule.calendar.declineReason' : 'schedule.calendar.cancelReason'))
      if (answer === null) return
      reason = answer.trim().slice(0, 300)
    }
    action.mutate({ id: booking.id, action: kind, reason })
  }
  const inactive = booking.status === 'cancelled' || booking.status === 'declined'
  return (
    <li className={`rounded-xl border border-line px-3 py-2 ${inactive ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums">{timeLabel(booking.starts_at)}–{timeLabel(booking.ends_at)}</span>
        <BookingStatusChip status={booking.status} />
      </div>
      <p className="text-sm">
        <Link to={`/trener/klijenti/${booking.client.id}`} className="font-semibold underline">{booking.client.name}</Link>
        {' · '}{booking.session_type.name}
      </p>
      {booking.note && <p className="text-xs text-muted">„{booking.note}“</p>}
      {booking.cancel_reason && <p className="text-xs text-muted">{booking.cancel_reason}</p>}
      <FormError message={action.error ? errorMessage(action.error) : null} />
      <div className="mt-1 flex flex-wrap gap-2">
        {booking.status === 'requested' && (
          <>
            <Button size="sm" disabled={action.isPending} onClick={() => run('confirm')}>{t('schedule.calendar.confirm')}</Button>
            <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => run('decline')}>{t('schedule.calendar.decline')}</Button>
          </>
        )}
        {booking.status === 'confirmed' && booking.can_cancel && (
          <Button size="sm" variant="ghost" className="text-danger" disabled={action.isPending} onClick={() => run('cancel')}>{t('schedule.cancel')}</Button>
        )}
      </div>
    </li>
  )
}

/** The coach books a session for one of his clients, at any time he chooses. */
function CoachBookingForm({ defaultDay, onDone }: { defaultDay: string; onDone: () => void }) {
  const { t } = useTranslation()
  const dashboard = useCoachDashboard()
  const types = useSessionTypes()
  const create = useCreateBooking()
  const clients = dashboard.data?.role === 'coach' ? dashboard.data.clients : []
  const [connectionId, setConnectionId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [day, setDay] = useState(defaultDay)
  const [time, setTime] = useState('09:00')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Kept across a retry of the same booking: a lost answer never books twice.
  const [pending, setPending] = useState<NewBooking | null>(null)
  const chosenType = typeId || types.data?.[0]?.id || ''

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!connectionId) return setError(t('schedule.calendar.chooseClient'))
    if (!chosenType) return setError(t('schedule.calendar.noTypes'))
    const body = { session_type_id: chosenType, starts_at: localMoment(day, time), note: note.trim(), connection_id: connectionId }
    const same = pending && pending.session_type_id === body.session_type_id && pending.starts_at === body.starts_at
      && pending.connection_id === body.connection_id && pending.note === body.note
    const request = same ? pending : { id: uuid(), ...body }
    setPending(request)
    create.mutate(request, { onSuccess: () => { setPending(null); onDone() } })
  }

  return (
    <Card title={t('schedule.calendar.newBooking')}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('schedule.calendar.client')}
          <select className={selectClass} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            <option value="">{t('schedule.calendar.chooseClient')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.client.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('schedule.type')}
          <select className={selectClass} value={chosenType} onChange={(e) => setTypeId(e.target.value)}>
            {(types.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} · {t('schedule.minutes', { count: x.duration_minutes })}</option>)}
          </select>
        </label>
        {types.data && types.data.length === 0 && (
          <p className="text-sm text-muted">{t('schedule.calendar.noTypes')} <Link to="/trener/kalendar/podesavanja" className="underline">{t('schedule.calendar.settings')}</Link></p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('schedule.calendar.day')} name="booking-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <Field label={t('schedule.calendar.time')} name="booking-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <Field label={`${t('schedule.note')} (${t('common.optional')})`} name="booking-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-xs text-muted">{t('schedule.calendar.coachHint')}</p>
        <FormError message={error ?? (create.error ? errorMessage(create.error) : null)} />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={create.isPending}>{create.isPending ? t('common.saving') : t('schedule.calendar.book')}</Button>
          <Button type="button" variant="ghost" onClick={onDone}>{t('schedule.close')}</Button>
        </div>
      </form>
    </Card>
  )
}
