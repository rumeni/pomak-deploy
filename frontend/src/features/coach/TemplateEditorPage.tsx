import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, Card, Field, FormError, LoadingScreen, ScreenHeader, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useRoutines } from '../training/api'
import { useArchiveTemplate, useSaveTemplate, useTemplates, WEEKDAYS, type ProgramTemplate, type Weekday } from './plansApi'

/** A program: the coach's routines on weekdays, for a number of weeks or open-ended. */
export function TemplateEditorPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const isNew = !id || id === 'novi'
  const templates = useTemplates()
  if (!isNew && templates.isLoading) return <LoadingScreen />
  const template = isNew ? null : templates.data?.find((x) => x.id === id) ?? null
  if (!isNew && !template) return <p className="p-6 text-center text-danger">{t('coachSpace.templates.notFound')}</p>
  return <Editor key={template?.id ?? 'new'} template={template} />
}

function Editor({ template }: { template: ProgramTemplate | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const routines = useRoutines()
  const save = useSaveTemplate()
  const archive = useArchiveTemplate()
  const [name, setName] = useState(template?.name ?? '')
  const [weeks, setWeeks] = useState(template?.weeks ? String(template.weeks) : '')
  const [notes, setNotes] = useState(template?.notes ?? '')
  const [days, setDays] = useState<Partial<Record<Weekday, string>>>(
    () => Object.fromEntries((template?.days ?? []).map((d) => [d.weekday, d.routine.id])),
  )
  const [error, setError] = useState<string | null>(null)
  // Only routines that can reach a client: with exercises, all from the shared library.
  const usable = (routines.data ?? []).filter((r) => r.exercises.length > 0 && r.exercises.every((x) => !x.exercise.is_custom))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const chosen = WEEKDAYS.filter((w) => days[w]).map((weekday) => ({ weekday, routine_id: days[weekday]! }))
    if (!name.trim()) return setError(t('coachSpace.templates.errors.name'))
    if (!chosen.length) return setError(t('coachSpace.templates.errors.days'))
    const weekCount = weeks.trim() ? Number(weeks) : null
    if (weekCount !== null && (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 52)) return setError(t('coachSpace.templates.errors.weeks'))
    save.mutate(
      { id: template?.id, body: { name: name.trim(), notes: notes.trim(), weeks: weekCount, days: chosen } },
      { onSuccess: () => navigate('/trener/programi', { replace: true }) },
    )
  }

  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={template ? t('coachSpace.templates.editTitle') : t('coachSpace.templates.newTitle')} onBack={() => navigate('/trener/programi')} />
      <form className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4" onSubmit={submit} noValidate>
        <Card>
          <div className="flex flex-col gap-4">
            <Field label={t('coachSpace.templates.name')} name="template-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <Field
              label={`${t('coachSpace.templates.weeksLabel')} (${t('common.optional')})`}
              name="template-weeks" type="number" inputMode="numeric" min={1} max={52} value={weeks}
              placeholder={t('coachSpace.templates.noEnd')}
              onChange={(e) => setWeeks(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
            />
          </div>
        </Card>
        <Card title={t('coachSpace.templates.week')}>
          <p className="mb-3 text-sm text-muted">{t('coachSpace.templates.weekHint')}</p>
          {routines.isError && <FormError message={t('errors.loadFailed')} />}
          <div className="flex flex-col gap-2">
            {WEEKDAYS.map((weekday) => (
              <label key={weekday} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
                <span className="text-sm font-semibold">{t(`coachSpace.weekday.${weekday}`)}</span>
                <select
                  className={selectClass}
                  value={days[weekday] ?? ''}
                  onChange={(e) => setDays((d) => ({ ...d, [weekday]: e.target.value || undefined }))}
                >
                  <option value="">{t('coachSpace.templates.rest')}</option>
                  {usable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  {/* A routine no longer usable still shows, so saving does not silently drop it. */}
                  {days[weekday] && !usable.some((r) => r.id === days[weekday]) && (
                    <option value={days[weekday]}>{template?.days.find((d) => d.weekday === weekday)?.routine.name ?? '…'}</option>
                  )}
                </select>
              </label>
            ))}
          </div>
          {routines.data && usable.length === 0 && <p className="mt-2 text-sm text-muted">{t('coachSpace.client.noSharedRoutines')}</p>}
        </Card>
        <Card>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="template-notes" className="text-sm font-medium">{t('coachSpace.templates.notes')} ({t('common.optional')})</label>
            <textarea id="template-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-2xl border border-line bg-card p-3 outline-none focus:border-brand" />
          </div>
        </Card>
        <p className="text-xs text-muted">{t('coachSpace.templates.copiesHint')}</p>
        <FormError message={error ?? (save.error ? errorMessage(save.error) : archive.error ? errorMessage(archive.error) : null)} />
        <Button disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
        {template && (
          <Button type="button" variant="ghost" className="text-danger" disabled={archive.isPending} onClick={() => {
            if (window.confirm(t('coachSpace.templates.archiveConfirm'))) archive.mutate(template.id, { onSuccess: () => navigate('/trener/programi', { replace: true }) })
          }}>{t('coachSpace.templates.archive')}</Button>
        )}
      </form>
    </div>
  )
}
