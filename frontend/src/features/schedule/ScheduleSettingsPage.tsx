import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, Card, Field, FormError, LoadingScreen, ScreenHeader, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import {
  useAddException, useArchiveSessionType, useDeleteException, useExceptions, useHours, useSaveHours, useSaveScheduleSettings,
  useSaveSessionType, useScheduleSettings, useSessionTypes,
  type Booking, type HoursWindow, type ScheduleSettings, type SessionMode, type SessionType,
} from './api'
import { ZoneNote } from './ZoneNote'
import { dayKey, dayLabel, rangesOverlap, timeLabel, validDayTime, zonedMoment } from './time'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

/** How clients book the coach: rules, weekly hours, session types and exceptions. */
export function ScheduleSettingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const settings = useScheduleSettings()
  const hours = useHours()
  if (settings.isLoading || hours.isLoading) return <LoadingScreen />
  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={t('schedule.settings.title')} onBack={() => navigate('/trener/kalendar')} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <ZoneNote />
        {(settings.isError || hours.isError) && <FormError message={t('errors.loadFailed')} />}
        <SessionTypesCard />
        {hours.data && <HoursCard key={JSON.stringify(hours.data.windows)} initial={hours.data.windows} />}
        {settings.data && <RulesCard key={JSON.stringify(settings.data)} initial={settings.data} />}
        <ExceptionsCard />
      </div>
    </div>
  )
}

function RulesCard({ initial }: { initial: ScheduleSettings }) {
  const { t } = useTranslation()
  const save = useSaveScheduleSettings()
  const [form, setForm] = useState(initial)
  const number = (key: 'cancel_hours' | 'min_notice_hours' | 'horizon_days', max: number) => (
    <Field
      label={t(`schedule.settings.${key}`)} name={key} type="number" inputMode="numeric" min={key === 'horizon_days' ? 1 : 0} max={max}
      value={String(form[key])} onChange={(e) => setForm((f) => ({ ...f, [key]: Math.min(max, Math.max(0, Number(e.target.value.replace(/\D/g, '') || 0))) }))}
    />
  )
  return (
    <Card title={t('schedule.settings.rules')}>
      <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(form) }} noValidate>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-brand" checked={!form.auto_confirm} onChange={(e) => setForm((f) => ({ ...f, auto_confirm: !e.target.checked }))} />
          {t('schedule.settings.manualConfirm')}
        </label>
        <p className="-mt-2 text-xs text-muted">{t('schedule.settings.manualConfirmHint')}</p>
        {number('cancel_hours', 168)}
        {number('min_notice_hours', 168)}
        {number('horizon_days', 90)}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('schedule.settings.slot_step_minutes')}
          <select className={selectClass} value={form.slot_step_minutes} onChange={(e) => setForm((f) => ({ ...f, slot_step_minutes: Number(e.target.value) as 15 | 30 | 60 }))}>
            {[15, 30, 60].map((m) => <option key={m} value={m}>{t('schedule.minutes', { count: m })}</option>)}
          </select>
        </label>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        {save.isSuccess && !save.isPending && <p role="status" className="text-sm text-brand-dark">{t('schedule.saved')}</p>}
        <Button disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
      </form>
    </Card>
  )
}

function HoursCard({ initial }: { initial: HoursWindow[] }) {
  const { t } = useTranslation()
  const save = useSaveHours()
  const [windows, setWindows] = useState<HoursWindow[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const update = (index: number, patch: Partial<HoursWindow>) => setWindows((ws) => ws.map((w, i) => (i === index ? { ...w, ...patch } : w)))
  const submit = () => {
    setError(null)
    for (const day of WEEKDAYS) {
      const list = windows.filter((w) => w.weekday === day)
      if (list.some((w) => w.end <= w.start)) return setError(t('schedule.settings.endAfterStart'))
      if (list.some((a, i) => list.some((b, j) => i < j && rangesOverlap(a, b)))) return setError(t('schedule.settings.noOverlap'))
    }
    save.mutate(windows)
  }
  return (
    <Card title={t('schedule.settings.hours')}>
      <p className="mb-3 text-sm text-muted">{t('schedule.settings.hoursHint')}</p>
      <div className="flex flex-col gap-3">
        {WEEKDAYS.map((day) => {
          const indexes = windows.map((w, i) => (w.weekday === day ? i : -1)).filter((i) => i >= 0)
          return (
            <div key={day} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{t(`coachSpace.weekday.${day}`)}</span>
                {indexes.length < 3 && (
                  <button type="button" className="min-h-10 text-sm font-semibold text-brand-dark underline"
                    onClick={() => setWindows((ws) => [...ws, { weekday: day, start: '09:00', end: '17:00' }])}>
                    {t('schedule.settings.addRange')}
                  </button>
                )}
              </div>
              {indexes.length === 0 && <p className="text-xs text-muted">{t('schedule.settings.dayOff')}</p>}
              {indexes.map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" step={900} aria-label={t('schedule.settings.from')} value={windows[i].start} onChange={(e) => update(i, { start: e.target.value })}
                    className="min-h-11 flex-1 rounded-xl border border-line bg-card px-3" />
                  <span aria-hidden>–</span>
                  <input type="time" step={900} aria-label={t('schedule.settings.to')} value={windows[i].end} onChange={(e) => update(i, { end: e.target.value })}
                    className="min-h-11 flex-1 rounded-xl border border-line bg-card px-3" />
                  <button type="button" aria-label={t('schedule.settings.removeRange')} className="flex size-11 items-center justify-center rounded-full text-danger active:bg-line"
                    onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <FormError message={error ?? (save.error ? errorMessage(save.error) : null)} />
      {save.isSuccess && !save.isPending && <p role="status" className="mt-2 text-sm text-brand-dark">{t('schedule.saved')}</p>}
      <Button className="mt-3 w-full" disabled={save.isPending} onClick={submit}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
    </Card>
  )
}

function SessionTypesCard() {
  const { t } = useTranslation()
  const types = useSessionTypes()
  const archive = useArchiveSessionType()
  const [editing, setEditing] = useState<SessionType | 'new' | null>(null)
  return (
    <Card title={t('schedule.settings.types')}>
      <p className="mb-2 text-sm text-muted">{t('schedule.settings.typesHint')}</p>
      {types.data?.length === 0 && <p className="text-sm text-muted">{t('schedule.calendar.noTypes')}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {types.data?.map((type) => (
          <li key={type.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="block font-semibold">{type.name}</span>
              <span className="block text-xs text-muted">{t('schedule.minutes', { count: type.duration_minutes })} · {t(`schedule.mode.${type.mode}`)}</span>
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(type)}>{t('schedule.edit')}</Button>
              <Button size="sm" variant="ghost" className="text-danger" disabled={archive.isPending}
                onClick={() => { if (window.confirm(t('schedule.settings.archiveConfirm', { name: type.name }))) archive.mutate(type.id) }}>
                {t('schedule.settings.archive')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {editing ? (
        <SessionTypeForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="secondary" className="mt-2 w-full" onClick={() => setEditing('new')}>{t('schedule.settings.addType')}</Button>
      )}
    </Card>
  )
}

function SessionTypeForm({ initial, onDone }: { initial: SessionType | null; onDone: () => void }) {
  const { t } = useTranslation()
  const save = useSaveSessionType()
  const [name, setName] = useState(initial?.name ?? '')
  const [duration, setDuration] = useState(String(initial?.duration_minutes ?? 60))
  const [mode, setMode] = useState<SessionMode>(initial?.mode ?? 'in_person')
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const minutes = Number(duration)
    if (!name.trim()) return setError(t('schedule.settings.nameRequired'))
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) return setError(t('schedule.settings.durationRange'))
    save.mutate({ id: initial?.id, name: name.trim(), duration_minutes: minutes, mode }, { onSuccess: onDone })
  }
  return (
    <form className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3" onSubmit={submit} noValidate>
      <Field label={t('schedule.settings.typeName')} name="type-name" maxLength={80} value={name} placeholder={t('schedule.settings.typeNamePlaceholder')} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('schedule.settings.duration')} name="type-duration" type="number" inputMode="numeric" min={15} max={240} step={5} value={duration}
          onChange={(e) => setDuration(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('schedule.settings.mode')}
          <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as SessionMode)}>
            <option value="in_person">{t('schedule.mode.in_person')}</option>
            <option value="online">{t('schedule.mode.online')}</option>
          </select>
        </label>
      </div>
      {initial && <p className="text-xs text-muted">{t('schedule.settings.durationKeepsBooked')}</p>}
      <FormError message={error ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="flex gap-2">
        <Button className="flex-1" disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>{t('schedule.close')}</Button>
      </div>
    </form>
  )
}

function ExceptionsCard() {
  const { t } = useTranslation()
  const exceptions = useExceptions()
  const add = useAddException()
  const remove = useDeleteException()
  const today = dayKey(new Date())
  const [kind, setKind] = useState<'closed' | 'open'>('closed')
  const [fromDay, setFromDay] = useState(today)
  const [fromTime, setFromTime] = useState('00:00')
  const [toDay, setToDay] = useState(today)
  const [toTime, setToTime] = useState('23:59')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Booking[]>([])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!validDayTime(fromDay, fromTime) || !validDayTime(toDay, toTime)) return setError(t('schedule.calendar.dayTimeRequired'))
    const starts_at = zonedMoment(fromDay, fromTime)
    const ends_at = zonedMoment(toDay, toTime)
    if (Date.parse(ends_at) <= Date.parse(starts_at)) return setError(t('schedule.settings.endAfterStart'))
    add.mutate({ kind, starts_at, ends_at, note: note.trim() }, {
      onSuccess: (data) => { setConflicts(data.conflicts); setNote('') },
    })
  }
  return (
    <Card title={t('schedule.exceptions.title')}>
      <p className="mb-2 text-sm text-muted">{t('schedule.exceptions.hint')}</p>
      <ul className="flex flex-col divide-y divide-line">
        {exceptions.data?.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className="block font-semibold">{e.kind === 'closed' ? t('schedule.exceptions.closed') : t('schedule.exceptions.open')}{e.note ? ` · ${e.note}` : ''}</span>
              <span className="block text-xs text-muted">{dayLabel(dayKey(e.starts_at))} {timeLabel(e.starts_at)} – {dayLabel(dayKey(e.ends_at))} {timeLabel(e.ends_at)}</span>
            </span>
            <Button size="sm" variant="ghost" className="text-danger" disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>{t('schedule.exceptions.remove')}</Button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('schedule.exceptions.kind')}
          <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as 'closed' | 'open')}>
            <option value="closed">{t('schedule.exceptions.closed')}</option>
            <option value="open">{t('schedule.exceptions.open')}</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('schedule.exceptions.fromDay')} name="ex-from-day" type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
          <Field label={t('schedule.settings.from')} name="ex-from-time" type="time" step={900} value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
          <Field label={t('schedule.exceptions.toDay')} name="ex-to-day" type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} />
          <Field label={t('schedule.settings.to')} name="ex-to-time" type="time" step={900} value={toTime} onChange={(e) => setToTime(e.target.value)} />
        </div>
        <Field label={`${t('schedule.note')} (${t('common.optional')})`} name="ex-note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        <FormError message={error ?? (add.error ? errorMessage(add.error) : null)} />
        <Button disabled={add.isPending}>{add.isPending ? t('common.saving') : t('schedule.exceptions.add')}</Button>
      </form>
      {conflicts.length > 0 && (
        <div role="status" className="mt-3 rounded-xl bg-accent/15 p-3 text-sm">
          <p className="font-semibold">{t('schedule.exceptions.conflicts', { count: conflicts.length })}</p>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((b) => <li key={b.id}>{dayLabel(dayKey(b.starts_at))} {timeLabel(b.starts_at)} · {b.client.name}</li>)}
          </ul>
        </div>
      )}
    </Card>
  )
}
