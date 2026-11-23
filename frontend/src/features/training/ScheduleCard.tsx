import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, FormError, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { weekdayOf } from '../coach/plans'
import { WEEKDAYS, type Weekday } from '../coach/plansApi'
import type { Routine } from './api'
import { useSaveSchedule, useSchedule } from './schedule'

/**
 * The athlete's own week on the Training tab: which routine on which day. For athletes without
 * a coach; while a coach's plan is active it decides the week instead (`coachPlan`).
 */
export function ScheduleCard({ routines, coachPlan }: { routines: Routine[] | undefined; coachPlan: boolean }) {
  const { t } = useTranslation()
  const schedule = useSchedule(!coachPlan)
  const save = useSaveSchedule()
  const [draft, setDraft] = useState<Partial<Record<Weekday, string>> | null>(null)
  if (coachPlan || !routines?.length || !schedule.data) return null

  const today = weekdayOf(new Date())
  const byDay = new Map(schedule.data.days.map((d) => [d.weekday, d]))
  const startEditing = () => {
    save.reset()
    setDraft(Object.fromEntries(schedule.data.days.map((d) => [d.weekday, d.routine_id])))
  }
  const onSave = () => {
    if (!draft) return
    const days = WEEKDAYS.flatMap((weekday) => (draft[weekday] ? [{ weekday, routine_id: draft[weekday]! }] : []))
    save.mutate(days, { onSuccess: () => setDraft(null) })
  }

  return (
    <section aria-labelledby="schedule-title" className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="schedule-title" className="text-lg font-bold tracking-tight">{t('mySchedule.title')}</h2>
          <p className="text-sm text-muted">{schedule.data.days.length ? t('mySchedule.intro') : t('mySchedule.empty')}</p>
        </div>
        {!draft && (
          <button type="button" onClick={startEditing} className="min-h-11 shrink-0 rounded-xl px-3 font-semibold text-brand-dark active:bg-brand-soft">
            {schedule.data.days.length ? t('mySchedule.edit') : t('mySchedule.create')}
          </button>
        )}
      </div>

      {draft ? (
        <div className="mt-3 flex flex-col gap-2">
          {WEEKDAYS.map((weekday) => (
            <label key={weekday} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2">
              <span className="text-sm font-semibold text-muted">{t(`coachSpace.weekdayShort.${weekday}`)}</span>
              <select
                value={draft[weekday] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [weekday]: e.target.value || undefined }))}
                aria-label={t(`mySchedule.dayAria.${weekday}`)}
                className={selectClass}
              >
                <option value="">{t('coachSpace.templates.rest')}</option>
                {routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          ))}
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <div className="mt-1 flex gap-2">
            <Button className="flex-1" onClick={onSave} disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => setDraft(null)} disabled={save.isPending}>{t('mySchedule.cancel')}</Button>
          </div>
        </div>
      ) : schedule.data.days.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-1 text-sm">
          {WEEKDAYS.map((weekday) => {
            const day = byDay.get(weekday)
            return (
              <li key={weekday} className={`flex gap-2 rounded-lg px-2 py-1 ${weekday === today ? 'bg-brand-soft font-semibold' : ''}`}>
                <span className="w-10 shrink-0 text-muted">{t(`coachSpace.weekdayShort.${weekday}`)}</span>
                <span className={day ? '' : 'text-muted'}>{day ? day.name : t('coachSpace.templates.rest')}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
