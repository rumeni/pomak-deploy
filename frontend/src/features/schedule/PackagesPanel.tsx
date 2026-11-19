import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { isCollaborationChanged } from '../coach/access'
import { useAddPackage, useChangePackage, useClientPackages, type SessionPackage } from './api'
import { dayKey, dayLabel } from './time'

/** A client's prepaid sessions (paid outside the app): what is used and what is left. */
export function PackagesPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const packages = useClientPackages(clientId)
  const [adding, setAdding] = useState(false)
  const data = packages.data
  return (
    <Card title={t('schedule.packages.title')}>
      <p className="mb-2 text-sm text-muted">{t('schedule.packages.hint')}</p>
      {packages.isLoading && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {packages.isError && !data && <FormError message={t('errors.loadFailed')} />}
      {data && data.packages.length === 0 && <p className="text-sm text-muted">{t('schedule.packages.none')}</p>}
      <ul className="flex flex-col gap-2">
        {data?.packages.map((p) => <PackageRow key={`${data.connection_id}:${p.id}`} clientId={clientId} connectionId={data.connection_id} pkg={p} />)}
      </ul>
      {data && (adding
        ? <PackageForm key={data.connection_id} clientId={clientId} connectionId={data.connection_id} onDone={() => setAdding(false)} />
        : <Button variant="secondary" className="mt-2 w-full" onClick={() => setAdding(true)}>{t('schedule.packages.add')}</Button>)}
    </Card>
  )
}

function PackageRow({ clientId, connectionId, pkg }: { clientId: string; connectionId: string; pkg: SessionPackage }) {
  const { t } = useTranslation()
  const change = useChangePackage(clientId)
  const inactive = pkg.closed || pkg.expired
  const adjust = () => {
    const answer = window.prompt(t('schedule.packages.adjustPrompt'))
    const value = answer === null ? NaN : Number(answer.trim())
    if (Number.isInteger(value) && value !== 0) change.mutate({ id: pkg.id, connection_id: connectionId, adjust_by: value })
  }
  return (
    <li className={`rounded-xl border border-line px-3 py-2 ${inactive ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{pkg.name}</span>
        <span className="text-sm font-bold tabular-nums">{t('schedule.packages.left', { count: pkg.remaining, total: pkg.total })}</span>
      </div>
      <p className="text-xs text-muted">
        {t('schedule.packages.used', { count: pkg.used })}
        {pkg.adjustment ? ` (${t('schedule.packages.correction', { value: pkg.adjustment > 0 ? `+${pkg.adjustment}` : pkg.adjustment })})` : ''}
        {' · '}{t('schedule.packages.from', { date: dayLabel(pkg.valid_from) })}
        {pkg.expires_on ? ` · ${t('schedule.packages.until', { date: dayLabel(pkg.expires_on) })}` : ''}
        {pkg.closed ? ` · ${t('schedule.packages.closed')}` : pkg.expired ? ` · ${t('schedule.packages.expired')}` : ''}
      </p>
      {pkg.note && <p className="text-xs text-muted">{pkg.note}</p>}
      {pkg.sessions.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-muted">{t('schedule.packages.sessions')}</summary>
          <ul className="mt-1 list-disc pl-5">
            {pkg.sessions.map((s) => (
              <li key={s.id}>{dayLabel(dayKey(s.starts_at))} · {s.type_name}{s.charged ? ` · ${t('schedule.calendar.charged')}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      <FormError message={isCollaborationChanged(change.error) ? t('coachSpace.collaborationChanged') : change.error ? errorMessage(change.error) : null} />
      {!pkg.closed && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={change.isPending} onClick={adjust}>{t('schedule.packages.adjust')}</Button>
          <Button size="sm" variant="ghost" className="text-danger" disabled={change.isPending}
            onClick={() => { if (window.confirm(t('schedule.packages.closeConfirm'))) change.mutate({ id: pkg.id, connection_id: connectionId, close: true }) }}>
            {t('schedule.packages.close')}
          </Button>
        </div>
      )}
    </li>
  )
}

function PackageForm({ clientId, connectionId, onDone }: { clientId: string; connectionId: string; onDone: () => void }) {
  const { t } = useTranslation()
  const add = useAddPackage(clientId)
  const today = dayKey(new Date())
  const [name, setName] = useState('')
  const [total, setTotal] = useState('12')
  const [validFrom, setValidFrom] = useState(today)
  const [expiresOn, setExpiresOn] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const count = Number(total)
    if (!name.trim()) return setError(t('schedule.settings.nameRequired'))
    if (!Number.isInteger(count) || count < 1 || count > 200) return setError(t('schedule.packages.totalRange'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) return setError(t('schedule.calendar.dayTimeRequired'))
    if (expiresOn && expiresOn < validFrom) return setError(t('schedule.settings.endAfterStart'))
    add.mutate({ connection_id: connectionId, name: name.trim(), total: count, valid_from: validFrom, expires_on: expiresOn || null, note: note.trim() },
      { onSuccess: onDone })
  }
  return (
    <form className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3" onSubmit={submit} noValidate>
      <Field label={t('schedule.settings.typeName')} name="package-name" maxLength={80} value={name} placeholder={t('schedule.packages.namePlaceholder')}
        onChange={(e) => setName(e.target.value)} />
      <Field label={t('schedule.packages.total')} name="package-total" type="number" inputMode="numeric" min={1} max={200} value={total}
        onChange={(e) => setTotal(e.target.value.replace(/\D/g, '').slice(0, 3))} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('schedule.packages.validFrom')} name="package-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <Field label={`${t('schedule.packages.expiresOn')} (${t('common.optional')})`} name="package-until" type="date" value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)} />
      </div>
      <Field label={`${t('schedule.note')} (${t('common.optional')})`} name="package-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      <FormError message={error ?? (isCollaborationChanged(add.error) ? t('coachSpace.collaborationChanged') : add.error ? errorMessage(add.error) : null)} />
      <div className="flex gap-2">
        <Button className="flex-1" disabled={add.isPending}>{add.isPending ? t('common.saving') : t('common.save')}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>{t('schedule.close')}</Button>
      </div>
    </form>
  )
}
