import { useTranslation } from 'react-i18next'

import { planDate, weekdayOf } from './plans'
import { WEEKDAYS, type PlanVersion } from './plansApi'

/** One plan version: its dates, the reason for it, and the week (today highlighted when current). */
export function PlanWeek({ version, highlightToday = false }: { version: PlanVersion; highlightToday?: boolean }) {
  const { t } = useTranslation()
  const today = weekdayOf(new Date())
  return (
    <div>
      <p className="font-semibold">{version.name}</p>
      <p className="text-xs text-muted">
        {version.valid_until
          ? t('coachSpace.plan.range', { from: planDate(version.valid_from), until: planDate(version.valid_until) })
          : t('coachSpace.plan.from', { from: planDate(version.valid_from) })}
      </p>
      {version.reason && <p className="mt-1 text-sm">„{version.reason}“</p>}
      {version.days.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('coachSpace.plan.paused')}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-1 text-sm">
          {WEEKDAYS.map((weekday) => {
            const day = version.days.find((d) => d.weekday === weekday)
            const isToday = highlightToday && weekday === today
            return (
              <li key={weekday} className={`flex gap-2 rounded-lg px-2 py-1 ${isToday ? 'bg-brand-soft font-semibold' : ''}`}>
                <span className="w-10 shrink-0 text-muted">{t(`coachSpace.weekdayShort.${weekday}`)}</span>
                <span className={day?.routine ? '' : 'text-muted'}>
                  {day ? day.routine?.name ?? t('coachSpace.plan.routineGone') : t('coachSpace.templates.rest')}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
