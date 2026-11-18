import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { isCollaborationChanged } from './access'
import { useClientGuard } from './guard'
import { useClientInstructions, useSaveInstruction, type ExerciseInstruction } from './inboxApi'

/**
 * The coach's standing instruction for one exercise of this client: shown to the client on that
 * exercise during every workout. Written for the collaboration it was opened in.
 */
export function InstructionEditor({ clientId, connectionId, exerciseId, current }: {
  clientId: string
  connectionId: string
  exerciseId: string
  current: string
}) {
  const { t } = useTranslation()
  const save = useSaveInstruction(clientId)
  const [open, setOpen] = useState(false)
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
    save.mutate({ connection_id: connectionId, exercise_id: exerciseId, text: value.trim() }, { onSuccess: () => setOpen(false) })
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
        <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setOpen(false)}>{t('coachSpace.instructions.cancel')}</Button>
      </div>
    </div>
  )
}

/** Every instruction for this client, in the Plan tab. */
export function InstructionsPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const list = useClientInstructions(clientId)
  const guard = useClientGuard(clientId, list)
  if (guard.state === 'revoked') return null
  const rows: ExerciseInstruction[] = list.data?.results ?? []
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
            <InstructionEditor key={row.text} clientId={clientId} connectionId={list.data.access.connection_id} exerciseId={row.exercise_id} current={row.text} />
          </li>
        ))}
      </ul>
    </Card>
  )
}
