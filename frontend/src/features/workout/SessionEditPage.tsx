import axios from 'axios'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ExerciseHeading } from '../training/ExerciseHeading'
import { SessionEditConflict, useEditSession, useSession, type WorkoutSession } from './api'
import {
  clearEditDraft,
  editChanged,
  editDraftToPayload,
  loadEditDraft,
  SessionEditError,
  sessionToEditDraft,
  storeEditDraft,
  type SessionEditDraft,
} from './edit'
import { inputFields, type Field } from './fields'
import { emptyActiveSet, MAX_EXERCISE_NOTES, type ActiveExercise, type ActiveSet } from './model'
import { ReadinessRow, ReadinessStep } from './ReadinessCard'
import { formatRpe } from './rpe'
import { RpeSheet } from './RpeSheet'

const FEELINGS = [1, 2, 3, 4, 5] as const
const MAX_SETS = 20

/** Correcting a finished, synced workout: set values, notes, feeling and the check-in. */
export function SessionEditPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { me } = useAuth()
  const remote = useSession(id, true, true)
  // After a conflict the form restarts from the version the server returned with it; it never
  // follows background refetches, so the edit baseline stays the revision it was made from.
  const [base, setBase] = useState<{ session: WorkoutSession; version: number } | null>(null)
  // Start only from a version fetched after opening: a cached copy may be older than a
  // correction made on another device, and the kept draft must be compared with the newest.
  // Once that arrived the editor stays: a later failed background refetch (React Query then
  // reports an error but keeps the data) must not replace an open form with an error page.
  const [openedAt] = useState(() => Date.now())
  const fresh = !!base || (!!remote.data && remote.dataUpdatedAt >= openedAt)

  if (!me || (!fresh && !remote.isError)) return <LoadingScreen />
  const session = base?.session ?? (fresh ? remote.data : undefined)
  if (!session) {
    return (
      <>
        <ScreenHeader title={t('history.edit.title')} onBack={() => navigate(-1)} />
        <p className="p-6 text-center text-danger">
          {axios.isAxiosError(remote.error) && !remote.error.response ? t('history.edit.offline') : t('history.notFound')}
        </p>
      </>
    )
  }
  return (
    <Editor
      key={base?.version ?? 0}
      session={session}
      ownerId={me.id}
      onReload={(current) => setBase((b) => ({ session: current, version: (b?.version ?? 0) + 1 }))}
    />
  )
}

function Editor({ session, ownerId, onReload }: { session: WorkoutSession; ownerId: string; onReload: (current: WorkoutSession) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const save = useEditSession()
  // Frozen for this editor instance: what "changed" is measured against.
  const [initial] = useState(() => sessionToEditDraft(session))
  const [kept] = useState(() => loadEditDraft(ownerId, initial.id, initial.revision))
  const restored = kept && !kept.stale ? kept.draft : null
  // A kept draft made against an older revision waits for the athlete's choice.
  const [staleDraft, setStaleDraft] = useState(kept?.stale ? kept.draft : null)
  const [draft, setDraft] = useState<SessionEditDraft>(restored ?? initial)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<WorkoutSession | null>(null)
  const [readinessOpen, setReadinessOpen] = useState(false)
  const changed = editChanged(initial, draft)
  const saving = save.isPending
  const back = () => navigate(`/trening/istorija/${initial.id}`, { replace: true })

  // Keep unsaved corrections on the device until they are saved or discarded. While an older
  // kept draft awaits a decision, leave it stored.
  useEffect(() => {
    if (staleDraft) return
    if (changed) storeEditDraft(ownerId, draft)
    else clearEditDraft(ownerId, initial.id)
  }, [changed, draft, ownerId, initial.id, staleDraft])

  const keepStaleDraft = () => {
    // The athlete chose their changes over the newer version: apply them to it.
    setDraft({ ...staleDraft!, revision: initial.revision })
    setStaleDraft(null)
  }
  const discardStaleDraft = () => {
    if (!window.confirm(t('history.edit.staleDiscardConfirm'))) return
    clearEditDraft(ownerId, initial.id)
    setStaleDraft(null)
  }

  // Closing or reloading the web page asks first; Android Back relies on the kept draft.
  useEffect(() => {
    if (!changed || saving) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [changed, saving])

  const updateExercise = (key: string, change: (e: ActiveExercise) => ActiveExercise) =>
    setDraft((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? change(e) : e)) }))

  const onSave = () => {
    if (saving) return
    setError(null)
    let body
    try {
      body = editDraftToPayload(draft)
    } catch (e) {
      if (!(e instanceof SessionEditError)) throw e
      return setError(e.exercise ? `${e.exercise}: ${t(e.key)}` : t(e.key))
    }
    save.mutate({ id: initial.id, body }, {
      onSuccess: () => {
        clearEditDraft(ownerId, initial.id)
        back()
      },
      onError: (e) => {
        if (e instanceof SessionEditConflict) return setConflict(e.current)
        setError(axios.isAxiosError(e) && !e.response ? t('history.edit.offline') : errorMessage(e))
      },
    })
  }

  const onBack = () => {
    if (saving) return
    // Leaving before choosing what to do with an older kept draft keeps it for next time.
    if (staleDraft) return back()
    if (changed && !window.confirm(t('history.edit.discardConfirm'))) return
    clearEditDraft(ownerId, initial.id)
    back()
  }

  const onReloadLatest = () => {
    if (!conflict || !window.confirm(t('history.edit.reloadConfirm'))) return
    clearEditDraft(ownerId, initial.id)
    onReload(conflict)
  }

  if (readinessOpen) {
    return (
      <ReadinessStep
        title={draft.name}
        readiness={draft.readiness}
        editing
        alert={null}
        onChange={(readiness) => setDraft((d) => ({ ...d, readiness }))}
        onBack={() => setReadinessOpen(false)}
        onSkip={() => setReadinessOpen(false)}
        onDone={() => setReadinessOpen(false)}
      />
    )
  }

  return (
    <div className="min-h-full pb-16">
      <ScreenHeader
        title={t('history.edit.title')}
        onBack={onBack}
        action={
          <Button className="min-h-10 px-4 text-sm" onClick={onSave} disabled={!changed || saving || !!conflict || !!staleDraft}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        }
      />
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <p className="text-sm text-muted">{t('history.edit.intro')}</p>
        {restored && changed && <p className="rounded-xl bg-accent/15 px-4 py-3 text-sm">{t('history.edit.restored')}</p>}
        {staleDraft && (
          <div role="alert" className="rounded-xl bg-accent/15 p-3 text-sm">
            <p>{t('history.edit.staleDraft')}</p>
            <div className="mt-2 flex flex-col gap-2">
              <Button onClick={keepStaleDraft}>{t('history.edit.staleKeep')}</Button>
              <Button variant="secondary" onClick={discardStaleDraft}>{t('history.edit.staleDiscard')}</Button>
            </div>
          </div>
        )}

        {conflict && (
          <div role="alert" className="rounded-xl bg-danger/10 p-3 text-danger">
            <p>{t('history.edit.conflict')}</p>
            <Button variant="secondary" className="mt-2" onClick={onReloadLatest}>{t('history.edit.reload')}</Button>
          </div>
        )}

        {/* While saving, nothing can change: a later edit would be lost when the save returns. */}
        <fieldset disabled={saving || !!staleDraft} className="flex min-w-0 flex-col gap-3 disabled:opacity-70">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            aria-label={t('history.edit.name')}
            maxLength={100}
            className="min-h-12 w-full rounded-xl border border-line bg-card px-4 text-lg font-semibold outline-none focus:border-brand"
          />

          <ReadinessRow readiness={draft.readiness} onOpen={() => setReadinessOpen(true)} />

          {draft.exercises.map((item) => (
            <ExerciseEditor key={item.key} item={item} onChange={(change) => updateExercise(item.key, change)} />
          ))}

          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('workout.feeling')}</legend>
            <div className="grid grid-cols-5 gap-1.5">
              {FEELINGS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={draft.feeling === f}
                  onClick={() => setDraft((d) => ({ ...d, feeling: d.feeling === f ? null : f }))}
                  className={`min-h-14 rounded-xl border-2 px-1 text-xs font-medium leading-tight ${
                    draft.feeling === f ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-card'
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
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={3}
              maxLength={2000}
              className="rounded-xl border border-line bg-card px-4 py-3 text-base outline-none focus:border-brand"
            />
          </label>
        </fieldset>

        <FormError message={error} />
        <Button onClick={onSave} disabled={!changed || saving || !!conflict || !!staleDraft}>
          {saving ? t('common.saving') : t('history.edit.save')}
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          {t('history.edit.cancel')}
        </Button>
      </div>
    </div>
  )
}

function ExerciseEditor({ item, onChange }: { item: ActiveExercise; onChange: (change: (e: ActiveExercise) => ActiveExercise) => void }) {
  const { t } = useTranslation()
  const [rpeFor, setRpeFor] = useState<string | null>(null)
  const { exercise } = item
  const m = exercise.measurement
  const showRpe = m !== 'duration' && m !== 'distance_duration'
  const fields = inputFields(m, exercise.load_mode === 'per_side', t, exercise.unilateral)
  const warmup = t('routine.warmupShort')
  const labels = item.sets.reduce<string[]>((acc, s) => {
    const done = acc.filter((l) => l !== warmup).length
    return [...acc, s.set_type === 'warmup' ? warmup : String(done + 1)]
  }, [])
  const rpeIndex = rpeFor ? item.sets.findIndex((s) => s.key === rpeFor) : -1
  const rpeSet = rpeIndex >= 0 ? item.sets[rpeIndex] : null

  const patchSet = (key: string, patch: Partial<ActiveSet>) =>
    onChange((e) => ({ ...e, sets: e.sets.map((s) => (s.key === key ? { ...s, ...patch } : s)) }))

  return (
    <section className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
      <div className="flex px-1">
        <ExerciseHeading exercise={exercise} />
      </div>
      <label className="mt-2 block px-1">
        <span className="text-xs font-medium text-muted">{t('workout.exerciseNotes')}</span>
        <textarea
          value={item.notes}
          onChange={(e) => onChange((x) => ({ ...x, notes: e.target.value }))}
          rows={1}
          maxLength={MAX_EXERCISE_NOTES}
          placeholder={t('workout.exerciseNotesPlaceholder')}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:bg-card"
        />
      </label>

      <div
        className="mt-3 grid items-center gap-x-1.5 gap-y-2"
        style={{ gridTemplateColumns: `2.25rem repeat(${fields.length}, minmax(0, 1fr))${showRpe ? ' 2.6rem' : ''} 2.5rem` }}
      >
        <span className="text-center text-[11px] font-medium text-muted">{t('routine.set')}</span>
        {fields.map((f) => (
          <span key={f.field} className="text-center text-[11px] font-medium text-muted">{f.label}</span>
        ))}
        {showRpe && <span className="text-center text-[11px] font-medium text-muted">{t('rpe.col')}</span>}
        <span />
        {item.sets.map((set, index) => (
          <EditSetRow
            key={set.key}
            label={labels[index]}
            set={set}
            fields={fields}
            showRpe={showRpe}
            onToggleType={() => patchSet(set.key, { set_type: set.set_type === 'warmup' ? 'working' : 'warmup' })}
            onChange={(patch) => patchSet(set.key, patch)}
            onOpenRpe={() => setRpeFor(set.key)}
            onRemove={() =>
              window.confirm(t('workout.removeSetConfirm', { n: labels[index] }))
              && onChange((e) => ({ ...e, sets: e.sets.filter((s) => s.key !== set.key) }))}
          />
        ))}
      </div>
      {item.sets.length === 0 && <p className="mt-2 px-1 text-sm text-danger">{t('history.edit.errors.noSets')}</p>}
      <button
        type="button"
        disabled={item.sets.length >= MAX_SETS}
        // A set added during a correction counts as done, without a time.
        onClick={() => onChange((e) => ({ ...e, sets: [...e.sets, { ...emptyActiveSet(), done: true }] }))}
        className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-brand-dark active:bg-brand-soft disabled:opacity-40"
      >
        {t('routine.addSet')}
      </button>
      {rpeSet && (
        <RpeSheet
          title={`${exercise.name} · ${t('routine.set')} ${labels[rpeIndex]}`}
          value={rpeSet.rpe ?? null}
          target={null}
          onPick={(rpe) => {
            patchSet(rpeSet.key, { rpe })
            setRpeFor(null)
          }}
          onClose={() => setRpeFor(null)}
        />
      )}
    </section>
  )
}

function EditSetRow({
  label,
  set,
  fields,
  showRpe,
  onToggleType,
  onChange,
  onOpenRpe,
  onRemove,
}: {
  label: string
  set: ActiveSet
  fields: Field[]
  showRpe: boolean
  onToggleType: () => void
  onChange: (patch: Partial<ActiveSet>) => void
  onOpenRpe: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const isWarmup = set.set_type === 'warmup'
  return (
    <>
      <button
        type="button"
        onClick={onToggleType}
        aria-label={isWarmup ? t('routine.warmupAria') : t('routine.setAria', { n: label })}
        className={`min-h-11 rounded-lg text-sm font-bold ${isWarmup ? 'bg-accent/20' : 'bg-surface'}`}
      >
        {label}
      </button>
      {fields.map((f) => (
        <input
          key={f.field}
          value={set[f.field]}
          onChange={(e) => onChange({ [f.field]: e.target.value })}
          inputMode={f.inputMode}
          aria-label={`${f.label} ${label}`}
          className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-1 text-center text-base tabular-nums outline-none focus:border-brand focus:bg-card"
        />
      ))}
      {showRpe && (
        <button
          type="button"
          onClick={onOpenRpe}
          aria-label={t('rpe.setAria', { n: label })}
          className={`min-h-11 rounded-lg text-sm tabular-nums ${
            typeof set.rpe === 'number' ? 'bg-accent/15 font-bold text-ink ring-1 ring-accent/40' : 'bg-surface text-muted ring-1 ring-line'
          }`}
        >
          {typeof set.rpe === 'number' ? formatRpe(set.rpe) : '–'}
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('history.edit.removeSet', { n: label })}
        className="flex min-h-11 items-center justify-center rounded-full text-muted active:bg-line"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M6 12h12" />
        </svg>
      </button>
    </>
  )
}
