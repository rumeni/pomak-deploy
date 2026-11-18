import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, Card, Field, FormError, LoadingScreen, ScreenHeader, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { DraftError } from '../training/draft'
import { useRoutines, type Routine } from '../training/api'
import { isCollaborationChanged } from './access'
import { useClientGuard } from './guard'
import { planDate, tailorDraft, tailoredRoutine, type TailorDraft } from './plans'
import { useClientPlan, useSavePlanVersion, WEEKDAYS, type ClientPlan, type PlanDayInput, type PlanRoutine, type Weekday } from './plansApi'

/** What a day of the new version holds. */
type DayChoice =
  | { kind: 'rest' }
  | { kind: 'keep'; routine: PlanRoutine }
  | { kind: 'copy'; routineId: string }
  | { kind: 'tailor'; draft: TailorDraft }

/** A coach routine in the plan's routine shape (for tailoring a copy). */
function asPlanRoutine(r: Routine): PlanRoutine {
  return {
    id: r.id, name: r.name,
    exercises: r.exercises.map((e) => ({
      exercise_id: e.exercise.id, name: e.exercise.name, name_en: '', measurement: e.exercise.measurement,
      rest_seconds: e.rest_seconds, notes: e.notes,
      sets: e.sets.map((s) => ({ ...s, rpe: s.rpe ?? null })),
    })),
  }
}

/** Changing a client's plan: a new version from a date (today or later), the past stays. */
export function PlanEditorPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const plan = useClientPlan(id ?? '')
  const guard = useClientGuard(id ?? '', plan)
  if (plan.isLoading) return <LoadingScreen />
  if (plan.isError || !id || !plan.data || guard.state === 'revoked') return <p className="p-6 text-center text-danger">{t('coach.clientNotFound')}</p>
  // Keyed by the collaboration: a reconnect opens a fresh editor, never a stale one.
  return <Editor key={plan.data.access.connection_id} clientId={id} connectionId={plan.data.access.connection_id} plan={plan.data.plan} />
}

function Editor({ clientId, connectionId, plan }: { clientId: string; connectionId: string; plan: ClientPlan | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const routines = useRoutines()
  const save = useSavePlanVersion(clientId)
  // The change starts from the plan in effect today; with a later version planned, the coach picks the base.
  const bases = plan?.versions.filter((v) => v.state !== 'past') ?? []
  const [baseId, setBaseId] = useState(() => bases.find((v) => v.state === 'current')?.id ?? bases[0]?.id ?? '')
  const latest = bases.find((v) => v.id === baseId) ?? null
  const planRoutines = [...new Map(bases.flatMap((v) => v.days).flatMap((d) => (d.routine?.id ? [[d.routine.id, d.routine] as const] : []))).values()]
  const usable = (routines.data ?? []).filter((r) => r.exercises.length > 0 && r.exercises.every((x) => !x.exercise.is_custom))
  const daysOf = (base: typeof latest) => Object.fromEntries(WEEKDAYS.map((w) => {
    const day = base?.days.find((d) => d.weekday === w)
    return [w, day?.routine?.id ? { kind: 'keep', routine: day.routine } : { kind: 'rest' }]
  })) as Record<Weekday, DayChoice>
  const [days, setDays] = useState<Record<Weekday, DayChoice>>(() => daysOf(latest))
  const [validFrom, setValidFrom] = useState(() => toISODate(new Date()))
  const [weeks, setWeeks] = useState(latest?.weeks ? String(latest.weeks) : '')
  const [name, setName] = useState(latest?.name ?? '')
  const [reason, setReason] = useState('')
  const [requestId] = useState(() => uuid())
  const [error, setError] = useState<string | null>(null)
  const today = toISODate(new Date())
  const setDay = (weekday: Weekday, choice: DayChoice) => setDays((d) => ({ ...d, [weekday]: choice }))

  const choose = (weekday: Weekday, value: string) => {
    if (!value) return setDay(weekday, { kind: 'rest' })
    const [kind, routineId] = value.split(':')
    const kept = planRoutines.find((r) => r.id === routineId)
    setDay(weekday, kind === 'keep' && kept ? { kind: 'keep', routine: kept } : { kind: 'copy', routineId })
  }

  const tailor = (weekday: Weekday) => {
    const choice = days[weekday]
    const source = choice.kind === 'keep' ? choice.routine
      : choice.kind === 'copy' ? (() => { const r = usable.find((x) => x.id === choice.routineId); return r ? asPlanRoutine(r) : null })()
        : null
    if (source) setDay(weekday, { kind: 'tailor', draft: tailorDraft(source, t('coachSpace.plan.tailoredSuffix')) })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const weekCount = weeks.trim() ? Number(weeks) : null
    if (weekCount !== null && (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 52)) return setError(t('coachSpace.templates.errors.weeks'))
    if (!validFrom || validFrom < today) return setError(t('coachSpace.plan.errors.date'))
    let input: PlanDayInput[]
    try {
      input = WEEKDAYS.flatMap((weekday): PlanDayInput[] => {
        const choice = days[weekday]
        if (choice.kind === 'keep') return choice.routine.id ? [{ weekday, keep_routine_id: choice.routine.id }] : []
        if (choice.kind === 'copy') return [{ weekday, routine_id: choice.routineId }]
        if (choice.kind === 'tailor') return [{ weekday, routine: tailoredRoutine(choice.draft) }]
        return []
      })
    } catch (e) {
      if (e instanceof DraftError) return setError(t(`routine.errors.${e.key}`, e.params))
      throw e
    }
    if (!input.length && !window.confirm(t('coachSpace.plan.pauseConfirm'))) return
    save.mutate(
      { connection_id: connectionId, valid_from: validFrom, weeks: weekCount, name: name.trim(), reason: reason.trim(), request_id: requestId, days: input },
      { onSuccess: () => navigate(`/trener/klijenti/${clientId}?tab=plan`, { replace: true }) },
    )
  }

  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={plan ? t('coachSpace.plan.change') : t('coachSpace.plan.create')} onBack={() => navigate(`/trener/klijenti/${clientId}?tab=plan`)} />
      <form className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4" onSubmit={submit} noValidate>
        <Card>
          <div className="flex flex-col gap-4">
            {bases.length > 1 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('coachSpace.plan.base')}</span>
                <select className={selectClass} value={baseId} onChange={(e) => {
                  const base = bases.find((v) => v.id === e.target.value) ?? null
                  setBaseId(e.target.value)
                  setDays(daysOf(base))
                  setWeeks(base?.weeks ? String(base.weeks) : '')
                  setName(base?.name ?? '')
                }}>
                  {bases.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.state === 'current' ? t('coachSpace.plan.current') : t('coachSpace.plan.from', { from: planDate(v.valid_from) })} · {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Field label={t('coachSpace.plan.validFrom')} name="valid-from" type="date" min={today} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            <p className="-mt-2 text-xs text-muted">{t('coachSpace.plan.validFromHint')}</p>
            <Field label={`${t('coachSpace.templates.name')} (${t('common.optional')})`} name="plan-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            <Field
              label={`${t('coachSpace.templates.weeksLabel')} (${t('common.optional')})`} name="plan-weeks" type="number" inputMode="numeric"
              min={1} max={52} value={weeks} placeholder={t('coachSpace.templates.noEnd')} onChange={(e) => setWeeks(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
            />
            <Field label={`${t('coachSpace.plan.reason')} (${t('common.optional')})`} name="plan-reason" maxLength={300} value={reason}
              placeholder={t('coachSpace.plan.reasonPlaceholder')} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Card>
        <Card title={t('coachSpace.templates.week')}>
          {routines.isError && <FormError message={t('errors.loadFailed')} />}
          <div className="flex flex-col gap-3">
            {WEEKDAYS.map((weekday) => {
              const choice = days[weekday]
              const value = choice.kind === 'keep' ? `keep:${choice.routine.id}` : choice.kind === 'copy' ? `copy:${choice.routineId}` : ''
              return (
                <div key={weekday} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
                  <label className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
                    <span className="text-sm font-semibold">{t(`coachSpace.weekday.${weekday}`)}</span>
                    {choice.kind === 'tailor' ? (
                      <span className="text-sm">{choice.draft.name} <span className="text-muted">· {t('coachSpace.plan.tailored')}</span></span>
                    ) : (
                      <select className={selectClass} value={value} onChange={(e) => choose(weekday, e.target.value)}>
                        <option value="">{t('coachSpace.templates.rest')}</option>
                        {planRoutines.length > 0 && (
                          <optgroup label={t('coachSpace.plan.fromPlan')}>
                            {planRoutines.map((r) => <option key={r.id} value={`keep:${r.id}`}>{r.name}</option>)}
                          </optgroup>
                        )}
                        <optgroup label={t('coachSpace.plan.fromMine')}>
                          {usable.map((r) => <option key={r.id} value={`copy:${r.id}`}>{r.name}</option>)}
                        </optgroup>
                      </select>
                    )}
                  </label>
                  {choice.kind === 'keep' || choice.kind === 'copy' ? (
                    <Button type="button" size="sm" variant="ghost" className="self-end" onClick={() => tailor(weekday)}>{t('coachSpace.plan.tailor')}</Button>
                  ) : choice.kind === 'tailor' ? (
                    <TailorEditor draft={choice.draft} onChange={(draft) => setDay(weekday, { kind: 'tailor', draft })} onCancel={() => setDay(weekday, { kind: 'rest' })} />
                  ) : null}
                </div>
              )
            })}
          </div>
        </Card>
        <p className="text-xs text-muted">{t('coachSpace.plan.futureOnly')}</p>
        <FormError message={error ?? (isCollaborationChanged(save.error) ? t('coachSpace.collaborationChanged') : save.error ? errorMessage(save.error) : null)} />
        <Button disabled={save.isPending}>{save.isPending ? t('common.saving') : t('coachSpace.plan.save')}</Button>
      </form>
    </div>
  )
}

/** Weights, reps, RPE and the number of sets of one routine, for one client. */
function TailorEditor({ draft, onChange, onCancel }: { draft: TailorDraft; onChange: (draft: TailorDraft) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const update = (index: number, change: (e: TailorDraft['exercises'][number]) => TailorDraft['exercises'][number]) =>
    onChange({ ...draft, exercises: draft.exercises.map((e, i) => (i === index ? change(e) : e)) })
  return (
    <div className="rounded-2xl border border-brand/40 bg-brand-soft/30 p-3">
      <Field label={t('coachSpace.templates.name')} name="tailor-name" maxLength={100} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      {draft.exercises.map((exercise, index) => {
        const adjustable = exercise.measurement === 'weight_reps' || exercise.measurement === 'weighted_bodyweight'
          || exercise.measurement === 'bodyweight_reps' || exercise.measurement === 'assisted_bodyweight'
        return (
          <div key={`${exercise.exercise_id}-${index}`} className="mt-3">
            <p className="text-sm font-semibold">{exercise.name}</p>
            {!adjustable ? <p className="text-xs text-muted">{t('coachSpace.plan.notAdjustable')}</p> : (
              <>
                <div className="mt-1 grid grid-cols-[1.5rem_1fr_1fr_1fr_2rem] items-center gap-1 text-xs text-muted">
                  <span>#</span><span>{t('coachSpace.plan.reps')}</span><span>{t('coachSpace.plan.weight')}</span><span>RPE</span><span />
                </div>
                {exercise.sets.map((set, i) => (
                  <div key={i} className="mt-1 grid grid-cols-[1.5rem_1fr_1fr_1fr_2rem] items-center gap-1">
                    <span className="text-xs text-muted">{set.set_type === 'warmup' ? t('routine.warmupShort') : i + 1}</span>
                    {(['reps', 'weight', 'rpe'] as const).map((field) => (
                      <input key={field} aria-label={`${exercise.name} ${i + 1} ${t(`coachSpace.plan.${field === 'rpe' ? 'rpeLabel' : field}`)}`}
                        inputMode={field === 'reps' ? 'text' : 'decimal'} value={set[field]}
                        onChange={(e) => update(index, (ex) => ({ ...ex, sets: ex.sets.map((s, j) => (j === i ? { ...s, [field]: e.target.value } : s)) }))}
                        className="app-input min-h-10 w-full rounded-xl border border-line bg-card px-2 text-sm outline-none focus:border-brand" />
                    ))}
                    <button type="button" aria-label={t('coachSpace.plan.removeSet')} disabled={exercise.sets.length <= 1}
                      onClick={() => update(index, (ex) => ({ ...ex, sets: ex.sets.filter((_, j) => j !== i) }))}
                      className="flex size-8 items-center justify-center rounded-full text-muted disabled:opacity-30">✕</button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" disabled={exercise.sets.length >= 20}
                  onClick={() => update(index, (ex) => ({ ...ex, sets: [...ex.sets, { ...ex.sets[ex.sets.length - 1] }] }))}>
                  + {t('coachSpace.plan.addSet')}
                </Button>
              </>
            )}
          </div>
        )
      })}
      <Button type="button" size="sm" variant="ghost" className="mt-2 text-danger" onClick={onCancel}>{t('coachSpace.plan.cancelTailor')}</Button>
    </div>
  )
}
