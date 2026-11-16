import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, EmptyState, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useDeleteRoutine, useDuplicateRoutine, useRoutine, useSaveRoutine, type Exercise } from './api'
import {
  DraftError,
  MAX_ROUTINE_EXERCISES,
  MAX_ROUTINE_SETS,
  draftToPayload,
  emptySet,
  newDraftExercise,
  newRoutineDraft,
  routineToDraft,
  type DraftExercise,
  type DraftSet,
  type RoutineDraft,
} from './draft'
import { ExercisePicker } from './ExercisePicker'
import { REST_OPTIONS, formatDuration } from './labels'
import { ExerciseHeading } from './ExerciseHeading'

type T = ReturnType<typeof useTranslation>['t']

export function RoutineEditorPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { data: routine, isLoading, isError } = useRoutine(id)

  if (id && isLoading) return <LoadingScreen />
  if (id && (isError || !routine)) return <p className="p-6 text-center text-danger">{t('routine.notFound')}</p>

  // key: posle učitavanja rutine nacrt kreće iznova od podataka sa servera.
  return <Editor key={routine?.id ?? 'new'} initial={routine ? routineToDraft(routine) : newRoutineDraft()} />
}

function Editor({ initial }: { initial: RoutineDraft }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [draft, setDraft] = useState(initial)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = useSaveRoutine()
  const remove = useDeleteRoutine()
  const duplicate = useDuplicateRoutine()

  const updateExercise = (key: string, change: (e: DraftExercise) => DraftExercise) =>
    setDraft((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? change(e) : e)) }))

  const move = (index: number, delta: number) =>
    setDraft((d) => {
      const list = [...d.exercises]
      const target = index + delta
      if (target < 0 || target >= list.length) return d
      ;[list[index], list[target]] = [list[target], list[index]]
      return { ...d, exercises: list }
    })

  const addExercises = (exercises: Exercise[]) => {
    if (draft.exercises.length + exercises.length > MAX_ROUTINE_EXERCISES) {
      setError(t('routine.errors.tooManyExercises', { count: MAX_ROUTINE_EXERCISES }))
      return
    }
    setError(null)
    setDraft((d) => ({ ...d, exercises: [...d.exercises, ...exercises.map(newDraftExercise)] }))
  }

  const onSave = () => {
    setError(null)
    try {
      const body = draftToPayload(draft)
      save.mutate({ isNew: draft.isNew, body }, { onSuccess: () => navigate('/trening', { replace: true }) })
    } catch (e) {
      if (e instanceof DraftError) setError(t(`routine.errors.${e.key}`, e.params))
      else throw e
    }
  }

  const onDelete = () => {
    if (!window.confirm(t('routine.confirmDelete', { name: draft.name }))) return
    remove.mutate(draft.id, { onSuccess: () => navigate('/trening', { replace: true }) })
  }

  const onDuplicate = () =>
    duplicate.mutate(draft.id, { onSuccess: (copy) => navigate(`/trening/rutine/${copy.id}`, { replace: true }) })

  const serverError = save.error ?? remove.error ?? duplicate.error

  return (
    <div className="min-h-full pb-44">
      <ScreenHeader
        title={draft.isNew ? t('routine.newTitle') : t('routine.editTitle')}
        onBack={() => navigate(-1)}
        action={
          <Button size="sm" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        }
      />

      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder={t('routine.namePlaceholder')}
          aria-label={t('routine.nameAria')}
          maxLength={100}
          className="min-h-14 w-full rounded-xl border border-line bg-card px-4 text-xl font-semibold outline-none focus:border-brand"
        />

        {draft.exercises.length === 0 && (
          <EmptyState title={t('routine.noExercises')} text={t('routine.noExercisesText')} />
        )}

        {draft.exercises.map((item, index) => (
          <ExerciseCard
            key={item.key}
            item={item}
            isFirst={index === 0}
            isLast={index === draft.exercises.length - 1}
            onChange={(change) => updateExercise(item.key, change)}
            onMove={(delta) => move(index, delta)}
            onRemove={() => setDraft((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== item.key) }))}
          />
        ))}

        <Button variant="secondary" onClick={() => setPickerOpen(true)}>
          {t('routine.addExercises')}
        </Button>

        <FormError message={error ?? (serverError ? errorMessage(serverError) : null)} />

        {!draft.isNew && (
          <div className="mt-6 flex flex-col gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={onDuplicate} disabled={duplicate.isPending}>
              {t('routine.duplicate')}
            </Button>
            <Button variant="ghost" className="text-danger" onClick={onDelete} disabled={remove.isPending}>
              {t('routine.delete')}
            </Button>
          </div>
        )}
      </div>

      {pickerOpen && <ExercisePicker onClose={() => setPickerOpen(false)} onAdd={addExercises} />}
    </div>
  )
}

function ExerciseCard({
  item,
  isFirst,
  isLast,
  onChange,
  onMove,
  onRemove,
}: {
  item: DraftExercise
  isFirst: boolean
  isLast: boolean
  onChange: (change: (e: DraftExercise) => DraftExercise) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [limitError, setLimitError] = useState<string | null>(null)
  const { exercise } = item
  const m = exercise.measurement
  const columns = setColumns(exercise, t)
  const warmup = t('routine.warmupShort')

  const updateSet = (key: string, patch: Partial<DraftSet>) =>
    onChange((e) => ({ ...e, sets: e.sets.map((s) => (s.key === key ? { ...s, ...patch } : s)) }))

  const addSet = () => {
    if (item.sets.length >= MAX_ROUTINE_SETS) {
      setLimitError(t('routine.errors.tooManySets', { count: MAX_ROUTINE_SETS }))
      return
    }
    setLimitError(null)
    onChange((e) => {
      // Nova serija preuzima vrednosti poslednje radne serije: najčešće su iste.
      const last = [...e.sets].reverse().find((s) => s.set_type === 'working')
      return { ...e, sets: [...e.sets, last ? { ...last, key: emptySet().key } : emptySet()] }
    })
  }

  // Radne serije se numerišu 1, 2, 3…; zagrevanje (Z / W) ne ulazi u brojanje.
  const labels = item.sets.reduce<string[]>((acc, s) => {
    const done = acc.filter((l) => l !== warmup).length
    return [...acc, s.set_type === 'warmup' ? warmup : String(done + 1)]
  }, [])

  return (
    <section className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
      <div className="flex items-start gap-2">
        <ExerciseHeading exercise={exercise}>
          {exercise.load_mode === 'per_side' && <p className="text-xs text-muted">{t('routine.perDumbbell')}</p>}
        </ExerciseHeading>
        <IconButton label={t('routine.moveUp')} disabled={isFirst} onClick={() => onMove(-1)} path="M6 15l6-6 6 6" />
        <IconButton label={t('routine.moveDown')} disabled={isLast} onClick={() => onMove(1)} path="M6 9l6 6 6-6" />
        <IconButton label={t('routine.removeExercise')} onClick={onRemove} path="M6 6l12 12M18 6L6 18" />
      </div>

      <label className="mt-2 flex items-center gap-2 px-1 text-sm text-muted">
        {t('routine.rest')}
        <select
          value={item.rest_seconds ?? 0}
          onChange={(e) => onChange((x) => ({ ...x, rest_seconds: Number(e.target.value) }))}
          className="min-h-10 rounded-lg border border-line bg-surface px-2 text-sm font-medium text-ink outline-none focus:border-brand"
        >
          {REST_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s ? formatDuration(s) : t('routine.noRest')}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 grid gap-x-2 gap-y-2" style={{ gridTemplateColumns: `2.75rem repeat(${columns.length}, minmax(0, 1fr)) 2.5rem` }}>
        <span className="text-center text-xs font-medium text-muted">{t('routine.set')}</span>
        {columns.map((c) => (
          <span key={c.field} className="text-center text-xs font-medium text-muted">
            {c.label}
          </span>
        ))}
        <span />

        {item.sets.map((s, i) => {
          const isWarmup = s.set_type === 'warmup'
          return (
            <SetRow
              key={s.key}
              label={labels[i]}
              isWarmup={isWarmup}
              set={s}
              columns={columns}
              onToggleType={() => updateSet(s.key, { set_type: isWarmup ? 'working' : 'warmup' })}
              onChange={(patch) => updateSet(s.key, patch)}
              onRemove={() => onChange((e) => ({ ...e, sets: e.sets.filter((x) => x.key !== s.key) }))}
            />
          )
        })}
      </div>

      <button type="button" onClick={addSet} className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-brand-dark active:bg-brand-soft">
        {t('routine.addSet')}
      </button>
      {limitError && <p role="alert" className="px-2 text-sm text-danger">{limitError}</p>}
      {m !== 'duration' && m !== 'distance_duration' && (
        <p className="px-1 text-xs text-muted">{t('routine.hint')}</p>
      )}
    </section>
  )
}

type Column = { field: 'reps' | 'weight' | 'duration' | 'distance'; label: string; placeholder: string; inputMode: 'numeric' | 'decimal' | 'text' }

function setColumns(exercise: Exercise, t: T): Column[] {
  // Oznaka u praznom polju ne sme da liči na upisanu vrednost (npr. "8-10").
  const reps: Column = { field: 'reps', label: t('routine.colReps'), placeholder: t('routine.phReps'), inputMode: 'text' }
  const duration: Column = { field: 'duration', label: t('routine.colTime'), placeholder: '0:45', inputMode: 'text' }
  const weight = (label: string): Column => ({ field: 'weight', label, placeholder: t('routine.phKg'), inputMode: 'decimal' })
  switch (exercise.measurement) {
    case 'weight_reps':
      return [weight(exercise.load_mode === 'per_side' ? t('routine.colKgPerDumbbell') : t('routine.colKg')), reps]
    case 'weighted_bodyweight':
      return [weight(t('routine.colAddedKg')), reps]
    case 'assisted_bodyweight':
      return [weight(t('routine.colAssistKg')), reps]
    case 'bodyweight_reps':
      return [reps]
    case 'duration':
      return [duration]
    case 'distance_duration':
      return [
        { field: 'distance', label: t('routine.colKm'), placeholder: t('routine.phKm'), inputMode: 'decimal' },
        { ...duration, placeholder: '30:00' },
      ]
  }
}

function SetRow({
  label,
  isWarmup,
  set,
  columns,
  onToggleType,
  onChange,
  onRemove,
}: {
  label: string
  isWarmup: boolean
  set: DraftSet
  columns: Column[]
  onToggleType: () => void
  onChange: (patch: Partial<DraftSet>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <button
        type="button"
        onClick={onToggleType}
        aria-label={isWarmup ? t('routine.warmupAria') : t('routine.setAria', { n: label })}
        className={`min-h-11 rounded-lg text-sm font-bold ${isWarmup ? 'bg-accent/20 text-ink' : 'bg-surface text-ink'}`}
      >
        {label}
      </button>
      {columns.map((c) => (
        <input
          key={c.field}
          value={set[c.field]}
          onChange={(e) => onChange({ [c.field]: e.target.value })}
          placeholder={c.placeholder}
          inputMode={c.inputMode}
          aria-label={c.label}
          className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-center text-base outline-none focus:border-brand focus:bg-card"
        />
      ))}
      <IconButton label={t('routine.removeSet')} onClick={onRemove} path="M6 12h12" small />
    </>
  )
}

function IconButton({ label, path, onClick, disabled, small }: { label: string; path: string; onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex ${small ? 'min-h-11 w-10' : 'size-10'} shrink-0 items-center justify-center rounded-full text-muted active:bg-line disabled:opacity-30`}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  )
}
