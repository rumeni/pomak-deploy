import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, FormError, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { isCollaborationChanged } from './access'
import { useClientGuard } from './guard'
import { useClientInstructions, useSaveInstruction, type ExerciseInstruction } from './inboxApi'
import { useClientPlan } from './plansApi'

/**
 * The coach's standing instruction for one exercise of this client: shown to the client on that
 * exercise during every workout. Written for the collaboration it was opened in.
 */
export function InstructionEditor({ clientId, connectionId, exerciseId, current, startOpen = false, onDone }: {
  clientId: string
  connectionId: string
  exerciseId: string
  current: string
  startOpen?: boolean
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const save = useSaveInstruction(clientId)
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState(current)
  if (!open) {
    return (
      <div className="mt-1">
        {current && <p className="text-sm"><span className="font-semibold">{t('coachSpace.instructions.label')}:</span> {current}</p>}
        <button type="button" className="min-h-10 text-sm font-semibold text-brand-dark underline" onClick={() => { setText(current); setOpen(true) }}>
          {current ? t('coachSpace.instructions.edit') : t('coachSpace.instructions.add')}
        </button>
      </div>
    )
  }
  const submit = (value: string) =>
    save.mutate({ connection_id: connectionId, exercise_id: exerciseId, text: value.trim() }, { onSuccess: () => { setOpen(false); onDone?.() } })
  return (
    <div className="mt-2 flex flex-col gap-2">
      <label className="sr-only" htmlFor={`instruction-${exerciseId}`}>{t('coachSpace.instructions.label')}</label>
      <textarea
        id={`instruction-${exerciseId}`} rows={3} maxLength={500} value={text} autoFocus
        placeholder={t('coachSpace.instructions.placeholder')}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-2xl border border-line bg-card p-3 text-sm outline-none focus:border-brand"
      />
      <p className="text-xs text-muted">{t('coachSpace.instructions.hint')}</p>
      <FormError message={isCollaborationChanged(save.error) ? t('coachSpace.collaborationChanged') : save.error ? errorMessage(save.error) : null} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => submit(text)}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
        {current && <Button size="sm" variant="ghost" className="text-danger" disabled={save.isPending} onClick={() => submit('')}>{t('coachSpace.instructions.remove')}</Button>}
        <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setOpen(false); onDone?.() }}>{t('coachSpace.instructions.cancel')}</Button>
      </div>
    </div>
  )
}

/** Every instruction for this client, in the Plan tab. */
export function InstructionsPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const list = useClientInstructions(clientId)
  const guard = useClientGuard(clientId, list)
  const plan = useClientPlan(clientId)
  const [adding, setAdding] = useState('')
  if (guard.state === 'revoked') return null
  const rows: ExerciseInstruction[] = list.data?.results ?? []
  // Exercises of the client's current and upcoming plan that have no instruction yet.
  const planned = new Map<string, string>()
  for (const version of plan.data?.plan?.versions ?? []) {
    if (version.state === 'past') continue
    for (const day of version.days) for (const x of day.routine?.exercises ?? []) planned.set(x.exercise_id, x.name)
  }
  const candidates = [...planned].filter(([id]) => !rows.some((r) => r.exercise_id === id))
  const sameCollaboration = !!list.data && plan.data?.access.connection_id === list.data.access.connection_id
  return (
    <Card title={t('coachSpace.instructions.title')}>
      <p className="mb-2 text-sm text-muted">{t('coachSpace.instructions.explanation')}</p>
      {list.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {list.isError && !list.data && <FormError message={t('errors.loadFailed')} />}
      {list.data && rows.length === 0 && <p className="text-sm text-muted">{t('coachSpace.instructions.empty')}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {list.data && rows.map((row) => (
          <li key={row.exercise_id} className="py-2">
            <p className="font-semibold">{row.exercise_name}</p>
            <InstructionEditor key={`${list.data.access.connection_id}:${row.exercise_id}:${row.text}`} clientId={clientId} connectionId={list.data.access.connection_id} exerciseId={row.exercise_id} current={row.text} />
          </li>
        ))}
      </ul>
      {list.data && sameCollaboration && candidates.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <label htmlFor="instruction-exercise" className="text-sm font-medium">{t('coachSpace.instructions.forExercise')}</label>
          <select id="instruction-exercise" className={selectClass} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{t('coachSpace.instructions.choose')}</option>
            {candidates.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          {adding && (
            <InstructionEditor key={`${list.data.access.connection_id}:${adding}`} clientId={clientId}
              connectionId={list.data.access.connection_id} exerciseId={adding} current="" startOpen onDone={() => setAdding('')} />
          )}
        </div>
      )}
    </Card>
  )
}
