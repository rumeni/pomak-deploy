import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, FormError, ScreenHeader } from '../../components/ui'
import { formatDecimal } from '../../lib/format'
import { formatDuration } from '../training/labels'
import { finishTimeForWorkout, SetInputError, summarize, toSessionPayload, type ActiveWorkout } from './model'
import { finishWorkout } from './outbox'
import { cancelRestEnd } from './restNotification'
import { clearActiveWorkout, StaleWorkoutError } from './store'
import { requestSync } from './sync'

const FEELINGS = [1, 2, 3, 4, 5] as const

/**
 * Kraj treninga. "Sačuvaj" upisuje trening u red za slanje na telefonu i odmah pokreće
 * slanje u pozadini; korisnik ne čeka server, a bez interneta se ništa ne gubi.
 */
export function FinishWorkout({
  workout,
  ownerId,
  onBack,
  onDone,
}: {
  workout: ActiveWorkout
  ownerId: string
  onBack: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  // A forgotten workout should end at its last confirmed set, not the next day's UI open.
  const [finishedAt] = useState(() => finishTimeForWorkout(workout, new Date()))
  const [feeling, setFeeling] = useState<number | null>(workout.draftFeeling ?? null)
  const [notes, setNotes] = useState(workout.draftNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const summary = summarize(workout, finishedAt)
  const unconfirmed = workout.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0)

  const onSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await finishWorkout(
        ownerId,
        toSessionPayload(workout, finishedAt, feeling, notes.trim()),
        workout.exercises.map((e) => e.exercise),
      )
      await cancelRestEnd()
      requestSync()
      onDone()
    } catch (cause) {
      setError(cause instanceof StaleWorkoutError
        ? t('workout.staleWorkout')
        : cause instanceof SetInputError ? t(cause.message) : t('errors.generic'))
      setSaving(false)
    }
  }

  const onDiscard = async () => {
    if (!window.confirm(t('workout.discardConfirm'))) return
    setSaving(true)
    setError(null)
    try {
      await clearActiveWorkout(ownerId, workout.id)
      // Never cancel a newer workout's timer if this screen is stale.
      await cancelRestEnd()
      onDone()
    } catch (cause) {
      setError(cause instanceof StaleWorkoutError ? t('workout.staleWorkout') : t('errors.generic'))
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('workout.summaryTitle')} onBack={onBack} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <h2 className="text-2xl font-bold">{workout.name}</h2>

        <dl className="grid grid-cols-3 gap-2">
          <Stat label={t('workout.duration')} value={formatDuration(summary.durationSeconds)} />
          <Stat label={t('workout.sets')} value={String(summary.doneSets)} />
          <Stat label={t('workout.volume')} value={`${formatDecimal(summary.volumeKg)} kg`} />
        </dl>

        {summary.doneSets === 0 ? (
          <p className="rounded-xl bg-accent/15 px-4 py-3 text-sm">{t('workout.noSetsYet')}</p>
        ) : (
          unconfirmed > 0 && <p className="text-sm text-muted">{t('workout.unconfirmedLeft', { count: unconfirmed })}</p>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('workout.feeling')}</legend>
          <div className="grid grid-cols-5 gap-1.5">
            {FEELINGS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={feeling === f}
                onClick={() => setFeeling(feeling === f ? null : f)}
                className={`min-h-14 rounded-xl border-2 px-1 text-xs font-medium leading-tight ${
                  feeling === f ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-card'
                }`}
              >
                {t(`workout.feeling${f}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('workout.notes')}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className="rounded-xl border border-line bg-card px-4 py-3 text-base outline-none focus:border-brand"
          />
        </label>

        <FormError message={error} />
        <Button onClick={() => void onSave()} disabled={saving || summary.doneSets === 0}>
          {saving ? t('common.saving') : t('workout.save')}
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          {t('workout.backToWorkout')}
        </Button>
        <Button variant="ghost" className="text-danger" onClick={() => void onDiscard()} disabled={saving}>
          {t('workout.discard')}
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card p-3 text-center ring-1 ring-line/60">
      <dt className="text-xs font-medium uppercase text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
    </div>
  )
}
