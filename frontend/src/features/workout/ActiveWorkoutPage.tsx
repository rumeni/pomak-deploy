import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'

import { BottomSheet } from '../../components/BottomSheet'
import { Button, LoadingScreen, ScreenHeader } from '../../components/ui'
import { getFormatLocale } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import type { Exercise } from '../training/api'
import { ExercisePicker } from '../training/ExercisePicker'
import { formatDuration } from '../training/labels'
import { FinishWorkout } from './FinishWorkout'
import {
  confirmSet,
  describeLogged,
  emptyActiveSet,
  MAX_EXERCISE_NOTES,
  moveExercise,
  newActiveExercise,
  planSummary,
  previousSet,
  removeExercise,
  replaceExercise,
  replacementLoss,
  rpeLoadRows,
  rpeTargetWeight,
  setExerciseNotes,
  SetInputError,
  targetRpe,
  suggestion,
  unconfirmSet,
  updateSet,
  type ActiveExercise,
  type ActiveSet,
  type ActiveWorkout,
} from './model'
import { loadPrevious } from './previous'
import { cancelRestEnd, restEndedFeedback, restNotificationAction, scheduleRestEnd } from './restNotification'
import { usePersistentWorkout } from './store'
import { useMyInstructions } from '../coach/inboxApi'
import { useAuth } from '../../lib/auth'
import { ExerciseHeading } from '../training/ExerciseHeading'
import { ReadinessRow, ReadinessStep } from './ReadinessCard'
import { formatRpe, parseRpe } from './rpe'
import { formatDecimal } from '../../lib/format'
import { RpeSheet } from './RpeSheet'
import { inputFields, type Field } from './fields'

// Match backend WorkoutSessionSerializer boundaries so a finished offline
// workout is never rejected merely for having too many items.
const MAX_SESSION_EXERCISES = 40
const MAX_SESSION_SETS = 20

type Update = (change: (w: ActiveWorkout) => ActiveWorkout) => void

export function ActiveWorkoutPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { loaded, row, update, flush, conflict } = usePersistentWorkout()
  const [pickerOpen, setPickerOpen] = useState(false)
  // Card whose exercise is being swapped (picker in "replace" mode).
  const [replaceFor, setReplaceFor] = useState<string | null>(null)
  // Never let a live cross-tab update swap the workout underneath an open
  // finish form (its local feeling/notes belong to the original workout).
  const [finishId, setFinishId] = useState<string | null>(null)
  const [editingCheckIn, setEditingCheckIn] = useState(false)
  const now = useNow()
  const workout = row?.workout

  // Obaveštenje za kraj pauze prati tajmer: novo vreme -> novo obaveštenje. Otkazuje se samo
  // ako je pauza prekinuta pre kraja (Preskoči, ±15 s); kad istekne, obaveštenje mora da ostane.
  const restEndsAt = workout?.rest?.endsAt
  const scheduledEnd = useRef<string | null>(null)
  useEffect(() => {
    const action = restNotificationAction(scheduledEnd.current, restEndsAt, new Date())
    if (action.cancel) void cancelRestEnd()
    if (action.schedule) {
      void scheduleRestEnd(new Date(action.schedule), t('workout.restDoneTitle'), t('workout.restDoneBody'), t('workout.restChannel'))
    }
    scheduledEnd.current = restEndsAt ?? null
  }, [restEndsAt, t])

  if (!loaded) return <LoadingScreen />
  if (!row || !workout) return <Navigate to="/trening" replace />

  if (finishId) {
    if (conflict || workout.id !== finishId) return (
      <div className="mx-auto max-w-xl p-4" role="alert">
        <p>{t('workout.staleWorkout')}</p>
        <Button variant="secondary" onClick={() => navigate('/trening', { replace: true })}>{t('common.retry')}</Button>
      </div>
    )
    return (
      <FinishWorkout key={finishId} workout={workout} ownerId={row.ownerId} flush={flush} onBack={() => setFinishId(null)} onDone={() => navigate('/trening', { replace: true })} />
    )
  }

  // Check-in comes first, on its own screen, until it is skipped or confirmed. A workout
  // already under way (e.g. restored from history) goes straight to the sets.
  const needsCheckIn = !workout.checkInDone && !workout.exercises.some((e) => e.sets.some((s) => s.done))
  // A failed save or another tab's edit stops all further writes; say so on every screen.
  const conflictAlert = conflict ? (
    <div role="alert" className="mx-auto max-w-xl rounded-xl bg-danger/10 p-3 text-danger">
      <p>{t('workout.concurrentEdit')}</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>{t('common.retry')}</Button>
    </div>
  ) : null

  if (needsCheckIn || editingCheckIn) {
    const close = () => {
      update((w) => ({ ...w, checkInDone: true }))
      setEditingCheckIn(false)
    }
    return (
      <ReadinessStep
        title={workout.name}
        readiness={workout.readiness}
        editing={editingCheckIn}
        alert={conflictAlert}
        onChange={(readiness) => update((w) => ({ ...w, readiness }))}
        onBack={() => (editingCheckIn ? setEditingCheckIn(false) : navigate('/trening'))}
        onSkip={() => {
          update((w) => ({ ...w, readiness: undefined, checkInDone: true }))
          setEditingCheckIn(false)
        }}
        onDone={close}
      />
    )
  }

  const addExercises = async (exercises: Exercise[]) => {
    if (workout.exercises.length + exercises.length > MAX_SESSION_EXERCISES) {
      window.alert(t('workout.errors.tooManyExercises', { count: MAX_SESSION_EXERCISES }))
      return
    }
    update((w) => ({ ...w, exercises: [...w.exercises, ...exercises.map(newActiveExercise)] }))
    const missing = exercises.map((e) => e.id).filter((id) => !workout.previous[id])
    const previous = await loadPrevious(missing)
    if (Object.keys(previous).length) update((w) => ({ ...w, previous: { ...w.previous, ...previous } }))
  }

  const replaceWith = async (exerciseKey: string, exercise: Exercise) => {
    try {
      replaceExercise(workout, exerciseKey, exercise) // validate first: the card may have confirmed sets
    } catch (e) {
      if (e instanceof SetInputError) return window.alert(t(e.message))
      throw e
    }
    const item = workout.exercises.find((e) => e.key === exerciseKey)
    const loss = item ? replacementLoss(item, exercise) : null
    // Typed values belong to the old exercise; never drop them without asking.
    if (loss && (loss.enteredSets || loss.resetsSets)) {
      const lines = [
        t('workout.swapConfirm', { from: item!.exercise.name, to: exercise.name }),
        loss.enteredSets ? t('workout.replaceLosesValues', { count: loss.enteredSets }) : null,
        loss.resetsSets ? t('workout.replaceResetsSets') : null,
      ]
      if (!window.confirm(lines.filter(Boolean).join('\n'))) return
    }
    // Another tab could confirm a set meanwhile; then keep the workout as it is.
    update((w) => {
      try {
        return replaceExercise(w, exerciseKey, exercise)
      } catch {
        return w
      }
    })
    if (workout.previous[exercise.id]) return
    const previous = await loadPrevious([exercise.id])
    if (Object.keys(previous).length) update((w) => ({ ...w, previous: { ...w.previous, ...previous } }))
  }

  const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(workout.startedAt).getTime()) / 1000))

  return (
    <div className="min-h-full pb-48">
      {conflictAlert}
      <ScreenHeader
        title={workout.name}
        onBack={() => navigate('/trening')}
        action={
          <Button className="min-h-10 px-4 text-sm" onClick={() => setFinishId(workout.id)}>
            {t('workout.finish')}
          </Button>
        }
      />
      <p className="mx-auto max-w-xl px-4 pt-2 text-sm font-medium tabular-nums text-muted">
        {t('workout.duration')}: {formatDuration(elapsed)}
      </p>

      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <ReadinessRow readiness={workout.readiness} onOpen={() => setEditingCheckIn(true)} />
        {workout.exercises.length === 0 && <p className="py-6 text-center text-muted">{t('workout.noExercises')}</p>}
        {workout.exercises.map((item, index) => (
          <WorkoutExerciseCard
            key={item.key}
            workout={workout}
            item={item}
            isFirst={index === 0}
            isLast={index === workout.exercises.length - 1}
            // The how-to line under the sets is the same on every card; show it once.
            showHint={index === 0}
            update={update}
            onReplace={() => setReplaceFor(item.key)}
          />
        ))}
        <Button variant="secondary" onClick={() => setPickerOpen(true)}>
          {t('workout.addExercise')}
        </Button>
      </div>

      {workout.rest && <RestTimer rest={workout.rest} now={now} update={update} />}
      {pickerOpen && <ExercisePicker onClose={() => setPickerOpen(false)} onAdd={(list) => void addExercises(list)} />}
      {replaceFor && (
        <ExercisePicker
          mode="replace"
          onClose={() => setReplaceFor(null)}
          onAdd={([exercise]) => exercise && void replaceWith(replaceFor, exercise)}
        />
      )}
    </div>
  )
}

function WorkoutExerciseCard({
  workout,
  item,
  isFirst,
  isLast,
  showHint,
  update,
  onReplace,
}: {
  workout: ActiveWorkout
  item: ActiveExercise
  isFirst: boolean
  isLast: boolean
  showHint: boolean
  update: Update
  onReplace: () => void
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [rpeFor, setRpeFor] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const { exercise } = item
  const m = exercise.measurement
  // RPE fits anything done for reps; for timed or distance work it says little.
  const showRpe = m !== 'duration' && m !== 'distance_duration'
  const rpeSetIndex = rpeFor ? item.sets.findIndex((s) => s.key === rpeFor) : -1
  const rpeSet = rpeSetIndex >= 0 ? item.sets[rpeSetIndex] : null
  const previous = workout.previous[exercise.id]
  const warmup = t('routine.warmupShort')
  const doneSets = item.sets.filter((s) => s.done).length

  const labels = item.sets.reduce<string[]>((acc, s) => {
    const done = acc.filter((l) => l !== warmup).length
    return [...acc, s.set_type === 'warmup' ? warmup : String(done + 1)]
  }, [])

  const fields = inputFields(m, exercise.load_mode === 'per_side', t)
  const plan = planSummary(item)
  // Where the grey weight comes from, per row, when the plan prescribes RPE instead of a weight.
  const rpeRows = rpeLoadRows(workout, item)
  const rpeDriven = rpeRows.calculated.length > 0 || rpeRows.missing.length > 0

  useEffect(() => {
    if (notesOpen) notesRef.current?.focus()
  }, [notesOpen])

  const toggleDone = (set: ActiveSet) => {
    setError(null)
    if (set.done) return update((w) => unconfirmSet(w, item.key, set.key))
    try {
      // Provera pre upisa: greška se prikazuje, a trening ostaje nepromenjen.
      confirmSet(workout, item.key, set.key, new Date())
      update((w) => confirmSet(w, item.key, set.key, new Date()))
    } catch (e) {
      if (e instanceof SetInputError) setError(t(e.message))
      else throw e
    }
  }

  const addSet = () => {
    if (item.sets.length >= MAX_SESSION_SETS) {
      setError(t('workout.errors.tooManySets', { count: MAX_SESSION_SETS }))
      return
    }
    update((w) => ({
      ...w,
      exercises: w.exercises.map((e) => (e.key === item.key ? { ...e, sets: [...e.sets, emptyActiveSet()] } : e)),
    }))
  }

  const removeSet = (key: string) =>
    update((w) => ({
      ...w,
      exercises: w.exercises.map((e) => (e.key === item.key ? { ...e, sets: e.sets.filter((s) => s.key !== key) } : e)),
    }))

  const act = (action: () => void) => () => {
    setMenuOpen(false)
    action()
  }
  const onRemoveExercise = () => {
    const question = doneSets
      ? t('workout.removeExerciseDoneConfirm', { name: exercise.name, count: doneSets })
      : t('workout.removeExerciseConfirm', { name: exercise.name })
    if (window.confirm(question)) update((w) => removeExercise(w, item.key))
  }

  const { me } = useAuth()
  const instruction = useMyInstructions(!!me && !me.profile.is_coach).data?.get(exercise.id)

  const planText = plan && [
    plan.warmups ? `${plan.warmups} ${warmup}` : null,
    ...plan.groups.map((g) =>
      `${g.count} × ${g.km ? `${g.km} km` : ''}${g.km && g.time ? ' · ' : ''}${g.time ?? (g.km ? '' : g.reps ?? '–')}${g.weight ? ` · ${g.weight} kg` : ''}${g.rpe !== null ? ` @ ${formatRpe(g.rpe)}` : ''}`),
  ].filter(Boolean).join(' + ')

  return (
    <section className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
      <div className="flex items-start gap-1 px-1">
        <ExerciseHeading exercise={exercise}>
          {previous && (
            <p className="text-xs text-muted">
              {t('workout.lastTime', { date: new Date(previous.started_at).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'long' }) })}
            </p>
          )}
        </ExerciseHeading>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={t('workout.exerciseMenu', { name: exercise.name })}
          aria-haspopup="dialog"
          className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-line"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>

      {instruction && (
        <p className="mt-2 whitespace-pre-wrap rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-dark">
          <span className="font-semibold">{t('workout.coachInstruction')}:</span> {instruction}
        </p>
      )}

      {(planText || rpeDriven) && (
        <div className="mt-2 flex flex-col gap-0.5 rounded-xl bg-surface px-3 py-2 text-xs">
          {planText && (
            <p>
              <span className="font-semibold uppercase tracking-wide text-muted">{t('workout.plan')}</span>{' '}
              <span className="font-semibold tabular-nums">{planText}</span>
            </p>
          )}
          {rpeRows.calculated.length > 0 && rpeRows.e1rm !== null && (
            <p className="text-muted">
              {t('workout.rpeLoadSource', {
                count: rpeRows.calculated.length,
                sets: rpeRows.calculated.map((i) => labels[i]).join(', '),
                e1rm: formatDecimal(Math.round(rpeRows.e1rm * 10) / 10),
              })}
            </p>
          )}
          {rpeRows.missing.length > 0 && (
            <p className="text-muted">
              {rpeRows.e1rm === null
                ? t('workout.rpeLoadMissing')
                : t('workout.rpeLoadOffChart', { count: rpeRows.missing.length, sets: rpeRows.missing.map((i) => labels[i]).join(', ') })}
            </p>
          )}
        </div>
      )}

      {(notesOpen || item.notes) && (
        <label className="mt-2 block px-1">
          <span className="text-xs font-medium text-muted">{t('workout.exerciseNotes')}</span>
          <textarea
            ref={notesRef}
            value={item.notes}
            onChange={(e) => update((w) => setExerciseNotes(w, item.key, e.target.value))}
            onBlur={() => setNotesOpen(false)}
            rows={2}
            maxLength={MAX_EXERCISE_NOTES}
            placeholder={t('workout.exerciseNotesPlaceholder')}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:bg-card"
          />
        </label>
      )}

      <div
        className="mt-3 grid items-center gap-x-1.5 gap-y-2"
        style={{ gridTemplateColumns: `2.25rem minmax(0, 1.2fr) repeat(${fields.length}, minmax(0, 1fr))${showRpe ? ' 2.6rem' : ''} 2.75rem` }}
      >
        <span className="text-center text-[11px] font-medium text-muted">{t('routine.set')}</span>
        <span className="text-center text-[11px] font-medium text-muted">{t('workout.colPrevious')}</span>
        {fields.map((f) => (
          <span key={f.field} className="text-center text-[11px] font-medium text-muted">
            {f.label}
          </span>
        ))}
        {showRpe && <span className="text-center text-[11px] font-medium text-muted">{t('rpe.col')}</span>}
        <span />

        {item.sets.map((set, index) => {
          const hint = suggestion(workout, item, index)
          const last = previousSet(workout, item, index)
          return (
            <SetRow
              key={set.key}
              label={labels[index]}
              set={set}
              previous={describeLogged(last, exercise, t('routine.phReps'))}
              previousRpe={showRpe ? parseRpe(last?.rpe) : null}
              fields={fields}
              hint={hint}
              hintFromRpe={rpeTargetWeight(workout, item, index)?.weight != null}
              showRpe={showRpe}
              onOpenRpe={() => setRpeFor(set.key)}
              onToggleType={() => update((w) => updateSet(w, item.key, set.key, { set_type: set.set_type === 'warmup' ? 'working' : 'warmup' }))}
              onChange={(patch) => update((w) => updateSet(w, item.key, set.key, patch))}
              onToggleDone={() => toggleDone(set)}
              onRemove={() => window.confirm(t('workout.removeSetConfirm', { n: labels[index] })) && removeSet(set.key)}
            />
          )
        })}
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="button" onClick={addSet} className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-brand-dark active:bg-brand-soft">
        {t('routine.addSet')}
      </button>
      {showHint && <p className="px-1 text-xs text-muted">{t('workout.setHint')}</p>}
      {rpeSet && (
        <RpeSheet
          title={`${exercise.name} · ${t('routine.set')} ${labels[rpeSetIndex]}`}
          value={rpeSet.rpe ?? null}
          target={targetRpe(rpeSet)}
          onPick={(rpe) => {
            update((w) => updateSet(w, item.key, rpeSet.key, { rpe }))
            setRpeFor(null)
          }}
          onClose={() => setRpeFor(null)}
        />
      )}
      {menuOpen && (
        <BottomSheet label={t('workout.exerciseMenu', { name: exercise.name })} kicker={exercise.name} title={t('workout.exerciseActions')} onClose={() => setMenuOpen(false)}>
          <ul className="mt-3 flex flex-col gap-1.5">
            <MenuItem onClick={act(() => setNotesOpen(true))} label={item.notes ? t('workout.editNotes') : t('workout.addNotes')} />
            <MenuItem
              onClick={act(onReplace)}
              label={t('workout.replaceExercise')}
              disabled={doneSets > 0}
              detail={doneSets > 0 ? t('workout.errors.replaceDone') : t('workout.replaceExerciseHint')}
            />
            <MenuItem onClick={act(() => update((w) => moveExercise(w, item.key, -1)))} label={t('workout.moveUp')} disabled={isFirst} />
            <MenuItem onClick={act(() => update((w) => moveExercise(w, item.key, 1)))} label={t('workout.moveDown')} disabled={isLast} />
            <MenuItem onClick={act(onRemoveExercise)} label={t('workout.removeExercise')} danger />
          </ul>
        </BottomSheet>
      )}
    </section>
  )
}

function MenuItem({ label, detail, onClick, disabled, danger }: { label: string; detail?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex min-h-12 w-full flex-col justify-center rounded-xl bg-card px-4 py-2 text-left ring-1 ring-line/70 active:bg-brand-soft disabled:opacity-50 ${danger ? 'text-danger' : ''}`}
      >
        <span className="font-semibold">{label}</span>
        {detail && <span className="text-xs font-normal text-muted">{detail}</span>}
      </button>
    </li>
  )
}

function SetRow({
  label,
  set,
  previous,
  previousRpe,
  fields,
  hint,
  hintFromRpe,
  showRpe,
  onOpenRpe,
  onToggleType,
  onChange,
  onToggleDone,
  onRemove,
}: {
  label: string
  set: ActiveSet
  previous: string
  /** RPE of last time's matching set, shown under it. */
  previousRpe: number | null
  fields: Field[]
  hint: Record<Field['field'], string>
  hintFromRpe: boolean
  showRpe: boolean
  onOpenRpe: () => void
  onToggleType: () => void
  onChange: (patch: Partial<ActiveSet>) => void
  onToggleDone: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const isWarmup = set.set_type === 'warmup'

  const rowTone = set.done ? 'bg-brand-soft' : ''
  return (
    <>
      <button
        type="button"
        onClick={onToggleType}
        // Dugo držanje (Android šalje "contextmenu") briše seriju; retko je potrebno, pa ne zauzima mesto u redu.
        onContextMenu={(e) => {
          e.preventDefault()
          onRemove()
        }}
        aria-label={isWarmup ? t('routine.warmupAria') : t('routine.setAria', { n: label })}
        className={`min-h-11 rounded-lg text-sm font-bold ${isWarmup ? 'bg-accent/20' : set.done ? 'bg-brand-soft' : 'bg-surface'}`}
      >
        {label}
      </button>
      <span className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg text-center text-sm tabular-nums leading-tight text-muted ${rowTone}`}>
        <span className="max-w-full truncate">{previous}</span>
        {previousRpe !== null && <span className="text-[11px] leading-none">@{formatRpe(previousRpe)}</span>}
      </span>
      {fields.map((f) => (
        <input
          key={f.field}
          value={set[f.field]}
          onChange={(e) => onChange({ [f.field]: e.target.value })}
          placeholder={hint[f.field]}
          inputMode={f.inputMode}
          aria-label={f.label}
          title={hintFromRpe && f.field === 'weight' ? t('rpe.fromRpe') : undefined}
          disabled={set.done}
          className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-1 text-center text-base tabular-nums outline-none placeholder:text-muted/60 focus:border-brand focus:bg-card disabled:border-transparent disabled:bg-brand-soft disabled:font-semibold disabled:text-ink"
        />
      ))}
      {showRpe && (
        // Stays tappable after ✓: RPE is usually known only once the set is done.
        <button
          type="button"
          onClick={onOpenRpe}
          aria-label={t('rpe.setAria', { n: label })}
          className={`min-h-11 rounded-lg text-sm tabular-nums ${
            typeof set.rpe === 'number'
              ? 'bg-accent/15 font-bold text-ink ring-1 ring-accent/40'
              : 'bg-surface text-muted ring-1 ring-line'
          }`}
        >
          {typeof set.rpe === 'number' ? formatRpe(set.rpe) : targetRpe(set) !== null ? `@${formatRpe(targetRpe(set)!)}` : '–'}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleDone}
        aria-pressed={set.done}
        aria-label={set.done ? t('workout.unconfirmAria', { n: label }) : t('workout.confirmAria', { n: label })}
        className={`flex min-h-11 items-center justify-center rounded-lg ${set.done ? 'bg-brand text-white' : 'bg-surface text-muted ring-1 ring-line'}`}
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12l5 5 9-10" />
        </svg>
      </button>
    </>
  )
}

function RestTimer({ rest, now, update }: { rest: NonNullable<ActiveWorkout['rest']>; now: Date; update: Update }) {
  const { t } = useTranslation()
  const remaining = Math.ceil((new Date(rest.endsAt).getTime() - now.getTime()) / 1000)
  const finished = remaining <= 0

  useEffect(() => {
    if (!finished) return
    void restEndedFeedback()
    update((w) => ({ ...w, rest: null }))
  }, [finished, update])

  const shift = (seconds: number) =>
    update((w) =>
      w.rest ? { ...w, rest: { ...w.rest, endsAt: new Date(new Date(w.rest.endsAt).getTime() + seconds * 1000).toISOString() } } : w,
    )

  const progress = Math.min(1, Math.max(0, remaining / rest.totalSeconds))
  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card shadow-lg" role="timer" aria-live="off">
      <div className="h-1 bg-brand transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
      <div className="mx-auto flex max-w-xl items-center gap-2 p-3">
        <div className="flex-1">
          <p className="text-xs font-medium uppercase text-muted">{t('workout.rest')}</p>
          <p className="text-2xl font-bold tabular-nums">
            {formatDuration(Math.max(0, remaining))} <span className="text-sm font-normal text-muted">{t('workout.restLeft')}</span>
          </p>
        </div>
        <Button variant="secondary" className="min-h-11 px-3 text-sm" onClick={() => shift(-15)}>
          {t('workout.minus15')}
        </Button>
        <Button variant="secondary" className="min-h-11 px-3 text-sm" onClick={() => shift(15)}>
          {t('workout.plus15')}
        </Button>
        <Button className="min-h-11 px-3 text-sm" onClick={() => update((w) => ({ ...w, rest: null }))}>
          {t('workout.skipRest')}
        </Button>
      </div>
    </div>
  )
}
