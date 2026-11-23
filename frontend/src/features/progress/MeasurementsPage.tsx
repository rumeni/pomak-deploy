import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Card, Field, FormError, ScreenHeader } from '../../components/ui'
import { LineChart } from '../../components/LineChart'
import { errorMessage } from '../../lib/api'
import { formatDecimal, formatShortDate, parseDecimal, toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { MEASUREMENT_KINDS, useAddMeasurement, useDeleteMeasurement, useMeasurements, type MeasurementKind } from './api'
import { measurementPoints } from './format'
import { ProgressPhotos } from './ProgressPhotos'

/** Telesna težina i obimi: unos, grafikon i lista. Vrsta je u adresi (?vrsta=waist). */
export function MeasurementsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const kind = (MEASUREMENT_KINDS.includes(params.get('vrsta') as MeasurementKind) ? params.get('vrsta') : 'weight') as MeasurementKind
  const unit = kind === 'weight' ? 'kg' : 'cm'
  const { data, isLoading, isError } = useMeasurements(kind)
  const remove = useDeleteMeasurement()
  const points = data ? measurementPoints(data) : []
  const fmt = (v: number) => `${formatDecimal(Math.round(v * 10) / 10)} ${unit}`
  // Body weight measured on a photo's day, shown under it when two photos are compared.
  const weights = useMeasurements('weight').data
  const weightOn = (date: string) => {
    const m = weights?.find((x) => x.measured_on === date)
    return m ? `${formatDecimal(Number(m.value))} kg` : null
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('progress.measurements')} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
          {MEASUREMENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === kind}
              onClick={() => setParams({ vrsta: k }, { replace: true })}
              className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium ring-1 ${
                k === kind ? 'bg-brand text-white ring-brand' : 'bg-card ring-line active:bg-brand-soft'
              }`}
            >
              {t(`progress.kind_${k}`)}
            </button>
          ))}
        </div>

        <AddMeasurement key={kind} kind={kind} unit={unit} />

        {isLoading && <p className="text-center text-muted">{t('common.loading')}</p>}
        {isError && <p className="text-center text-danger">{t('progress.loadFailed')}</p>}

        {points.length > 1 && (
          <Card>
            <LineChart points={points} format={fmt} label={t(`progress.kind_${kind}`)} />
          </Card>
        )}

        {data?.length === 0 && <p className="text-center text-muted">{t('progress.noMeasurements')}</p>}
        {!!data?.length && (
          <ul className="flex flex-col rounded-2xl bg-card shadow-sm ring-1 ring-line/60">
            {data.map((m) => (
              <li key={m.id} className="flex min-h-14 items-center gap-3 border-b border-line py-1 pl-4 pr-1 last:border-0">
                <span className="flex-1 text-muted">{formatShortDate(m.measured_on)}</span>
                <span className="font-semibold tabular-nums">{fmt(Number(m.value))}</span>
                <button
                  type="button"
                  aria-label={t('progress.deleteMeasurement', { value: fmt(Number(m.value)), date: formatShortDate(m.measured_on) })}
                  onClick={() => {
                    if (window.confirm(t('progress.deleteMeasurementConfirm', { value: fmt(Number(m.value)), date: formatShortDate(m.measured_on) }))) {
                      remove.mutate(m.id)
                    }
                  }}
                  className="flex size-11 items-center justify-center rounded-xl text-muted active:bg-line"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <FormError message={remove.isError ? errorMessage(remove.error) : null} />

        <ProgressPhotos source={{ kind: 'own' }} weightOn={weightOn} />
      </div>
    </div>
  )
}

function AddMeasurement({ kind, unit }: { kind: MeasurementKind; unit: string }) {
  const { t } = useTranslation()
  const add = useAddMeasurement()
  const [value, setValue] = useState('')
  const [date, setDate] = useState(toISODate(new Date()))
  const [error, setError] = useState<string | null>(null)
  // Isti ID pri ponovnom pokušaju: server neće upisati merenje dva puta.
  const id = useRef(uuid())

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const n = parseDecimal(value)
    if (n === null) return setError(t('progress.invalidValue'))
    add.mutate(
      { id: id.current, kind, value: String(n), measured_on: date },
      {
        onSuccess: () => {
          id.current = uuid()
          setValue('')
        },
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60">
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t(`progress.kind_${kind}`)} (${unit})`} name="value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <Field label={t('progress.date')} name="measured_on" type="date" max={toISODate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <FormError message={error ?? (add.isError ? errorMessage(add.error) : null)} />
      <Button type="submit" disabled={add.isPending}>
        {add.isPending ? t('common.saving') : t('progress.addMeasurement')}
      </Button>
    </form>
  )
}
