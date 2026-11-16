import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, Field, FormError, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { addDays, formatDecimal, formatShortDate, parseDecimal, toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { GOAL_KINDS, useCreateGoal, useMeasurements, type GoalKind, type MeasurementKind } from './api'
import { goalRange, goalValueInRange } from './goalLimits'
import { goalAlreadySavedConflict } from './goalRetry'

/** Novi cilj napretka: telesna mera (polazna vrednost = poslednje merenje) ili broj treninga nedeljno. */
export function GoalFormPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [kind, setKind] = useState<GoalKind>('weight')
  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('progress.newGoalTitle')} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t('progress.goalKindLegend')}</legend>
          <div className="flex flex-wrap gap-2">
            {GOAL_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={k === kind}
                onClick={() => setKind(k)}
                className={`min-h-11 rounded-full px-4 text-sm font-medium ring-1 ${
                  k === kind ? 'bg-brand text-white ring-brand' : 'bg-card ring-line active:bg-brand-soft'
                }`}
              >
                {t(`progress.goalKind_${k}`)}
              </button>
            ))}
          </div>
        </fieldset>
        {kind === 'workouts_per_week' ? <GoalForm key={kind} kind={kind} /> : <BodyGoalForm key={kind} kind={kind} />}
      </div>
    </div>
  )
}

function BodyGoalForm({ kind }: { kind: MeasurementKind }) {
  const { data, isLoading } = useMeasurements(kind)
  if (isLoading) return null
  return <GoalForm kind={kind} latest={data?.[0] ? { value: Number(data[0].value), date: data[0].measured_on } : null} />
}

function GoalForm({ kind, latest }: { kind: GoalKind; latest?: { value: number; date: string } | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateGoal()
  const workouts = kind === 'workouts_per_week'
  const unit = kind === 'weight' ? 'kg' : 'cm'
  const [start, setStart] = useState('')
  const [target, setTarget] = useState('')
  const [until, setUntil] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Isti ID pri ponovnom pokušaju: server neće napraviti dva cilja.
  const id = useRef(uuid())

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const targetValue = workouts ? (/^\d+$/.test(target.trim()) ? Number(target) : null) : parseDecimal(target)
    if (targetValue === null) return setError(t(workouts ? 'progress.errors.workouts' : 'progress.invalidValue'))
    const [low, high] = goalRange(kind)
    if (!goalValueInRange(kind, targetValue)) {
      return setError(workouts ? t('progress.errors.workouts') : t('progress.errors.range', { low, high }))
    }
    let startValue: number | null = null
    if (!workouts && !latest) {
      startValue = parseDecimal(start)
      if (startValue === null) return setError(t('progress.errors.start'))
      if (!goalValueInRange(kind, startValue)) return setError(t('progress.errors.range', { low, high }))
    }
    create.mutate(
      { id: id.current, kind, target_value: String(targetValue), start_value: startValue === null ? null : String(startValue), target_date: until || null },
      {
        onSuccess: () => navigate('/napredak', { replace: true }),
        onError: (e) => {
          if (!goalAlreadySavedConflict(e)) return
          // A previous request may already have created the goal; its original
          // ID must not trap subsequent submissions in repeated 409 conflicts.
          // useCreateGoal invalidates ['goals'] before navigation.
          id.current = uuid()
          navigate('/napredak', { replace: true })
        },
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {!workouts &&
        (latest ? (
          <p className="text-sm text-muted">{t('progress.startFromLatest', { value: `${formatDecimal(latest.value)} ${unit}`, date: formatShortDate(latest.date) })}</p>
        ) : (
          <Field label={t('progress.startValue', { unit })} name="start" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
        ))}
      <Field
        label={workouts ? t('progress.targetWorkouts') : t('progress.targetValue', { unit })}
        name="target"
        inputMode={workouts ? 'numeric' : 'decimal'}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />
      {!workouts && (
        <Field label={t('progress.targetDate')} name="until" type="date" min={addDays(toISODate(new Date()), 1)} value={until} onChange={(e) => setUntil(e.target.value)} />
      )}
      <FormError message={error ?? (create.isError ? errorMessage(create.error) : null)} />
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? t('common.saving') : t('progress.saveGoal')}
      </Button>
    </form>
  )
}
