import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, FormError, ScreenHeader, SelectField } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useDebounced } from '../../lib/useDebounced'
import { useCreateExercise, useExercises, type Exercise, type Muscle, type NewExercise } from './api'
import { EQUIPMENT, MEASUREMENTS, MUSCLES } from './labels'
import { ExerciseThumbButton } from './ExerciseHeading'
import { ExerciseInfoSheet } from './ExerciseInfoSheet'

/** Izbor vežbi preko celog ekrana. Može da se izabere više vežbi odjednom. */
export function ExercisePicker({ onClose, onAdd }: { onClose: () => void; onAdd: (exercises: Exercise[]) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | ''>('')
  const [selected, setSelected] = useState<Exercise[]>([])
  const [creating, setCreating] = useState(false)
  const [info, setInfo] = useState<Exercise | null>(null)
  const search = useDebounced(q)
  const { data: exercises, isLoading, isError } = useExercises(search, muscle)

  // Sistemsko "nazad" zatvara izbor umesto da napusti ceo ekran rutine: izbor dodaje
  // svoj zapis u istoriju, a zatvaranje (bilo kojim putem) ide preko history.back().
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    window.history.pushState({ picker: true }, '')
    const onPop = () => onCloseRef.current()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const close = () => window.history.back()

  const toggle = (exercise: Exercise) =>
    setSelected((list) => (list.some((e) => e.id === exercise.id) ? list.filter((e) => e.id !== exercise.id) : [...list, exercise]))

  if (creating) {
    return (
      <Overlay>
        <CreateExerciseForm
          initialName={q}
          onCancel={() => setCreating(false)}
          onCreated={(exercise) => {
            setCreating(false)
            setSelected((list) => [...list, exercise])
          }}
        />
      </Overlay>
    )
  }

  const filters: { value: Muscle | ''; label: string }[] = [
    { value: '', label: t('picker.all') },
    ...MUSCLES.map((m) => ({ value: m, label: t(`muscle.${m}`) })),
  ]

  return (
    <Overlay>
      <ScreenHeader title={t('picker.title')} onBack={close} />
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 bg-surface px-4 pb-2 pt-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('picker.searchPlaceholder')}
          aria-label={t('picker.searchAria')}
          className="min-h-12 w-full rounded-xl border border-line bg-card px-4 text-base outline-none focus:border-brand"
        />
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
          {filters.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMuscle(m.value)}
              aria-pressed={muscle === m.value}
              className={`min-h-9 shrink-0 rounded-full px-4 text-sm font-medium ${
                muscle === m.value ? 'bg-brand text-white' : 'bg-card text-ink ring-1 ring-line'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="flex flex-col px-4 pb-40">
        {isLoading && <li className="py-6 text-center text-muted">{t('common.loading')}</li>}
        {isError && <li className="py-6 text-center text-danger">{t('picker.loadFailed')}</li>}
        {exercises?.length === 0 && <li className="py-6 text-center text-muted">{t('picker.noResults', { q: search })}</li>}
        {exercises?.map((exercise) => {
          const isSelected = selected.some((e) => e.id === exercise.id)
          return (
            <li key={exercise.id} className="border-b border-line last:border-0">
              <label className="flex min-h-16 cursor-pointer items-center gap-3 py-2">
                <input type="checkbox" checked={isSelected} onChange={() => toggle(exercise)} className="size-5 shrink-0 accent-brand" />
                <ExerciseThumbButton exercise={exercise} onClick={() => setInfo(exercise)} label={t('exerciseInfo.open', { name: exercise.name })} />
                <span className="flex-1">
                  <span className="block font-medium">{exercise.name}</span>
                  <span className="block text-sm text-muted">
                    {t(`muscle.${exercise.muscle}`)} · {t(`equipment.${exercise.equipment}`)}
                    {exercise.is_custom && ` · ${t('picker.myExercise')}`}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {info && <ExerciseInfoSheet exercise={info} onClose={() => setInfo(null)} />}

      <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card">
        <div className="mx-auto flex max-w-xl flex-col gap-2 p-3">
          <Button
            onClick={() => {
              onAdd(selected)
              close()
            }}
            disabled={!selected.length}
          >
            {selected.length ? t('picker.add', { count: selected.length }) : t('picker.choose')}
          </Button>
          <Button variant="ghost" onClick={() => setCreating(true)}>
            {t('picker.createOwn')}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-30 overflow-y-auto bg-surface">{children}</div>
}

function CreateExerciseForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string
  onCancel: () => void
  onCreated: (exercise: Exercise) => void
}) {
  const { t } = useTranslation()
  const create = useCreateExercise()
  const [form, setForm] = useState<NewExercise>({
    name: initialName,
    equipment: 'machine',
    measurement: 'weight_reps',
    muscle: 'chest',
    load_mode: 'total',
  })
  const set = <K extends keyof NewExercise>(key: K, value: NewExercise[K]) => setForm((f) => ({ ...f, [key]: value }))
  const perSideRelevant = form.equipment === 'dumbbell' || form.equipment === 'kettlebell'

  return (
    <>
      <ScreenHeader title={t('newExercise.title')} onBack={onCancel} />
      <form
        className="mx-auto flex max-w-xl flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate({ ...form, load_mode: perSideRelevant ? form.load_mode : 'total' }, { onSuccess: onCreated })
        }}
      >
        <Field label={t('newExercise.name')} name="name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        <SelectField label={t('newExercise.muscle')} name="muscle" value={form.muscle} onChange={(e) => set('muscle', e.target.value as NewExercise['muscle'])}>
          {MUSCLES.map((m) => (
            <option key={m} value={m}>
              {t(`muscle.${m}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('newExercise.equipment')} name="equipment" value={form.equipment} onChange={(e) => set('equipment', e.target.value as NewExercise['equipment'])}>
          {EQUIPMENT.map((m) => (
            <option key={m} value={m}>
              {t(`equipment.${m}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('newExercise.measurement')} name="measurement" value={form.measurement} onChange={(e) => set('measurement', e.target.value as NewExercise['measurement'])}>
          {MEASUREMENTS.map((m) => (
            <option key={m} value={m}>
              {t(`measurement.${m}`)}
            </option>
          ))}
        </SelectField>
        {perSideRelevant && (
          <SelectField label={t('newExercise.loadMode')} name="load_mode" value={form.load_mode} onChange={(e) => set('load_mode', e.target.value as NewExercise['load_mode'])}>
            <option value="per_side">{t('newExercise.perSide')}</option>
            <option value="total">{t('newExercise.total')}</option>
          </SelectField>
        )}
        <FormError message={create.isError ? errorMessage(create.error) : null} />
        <Button type="submit" disabled={create.isPending || !form.name.trim()}>
          {create.isPending ? t('common.saving') : t('newExercise.save')}
        </Button>
      </form>
    </>
  )
}
