import { useTranslation } from 'react-i18next'

import { Card } from '../../components/ui'
import { changeNotice, planDate } from './plans'
import { useMyPlan } from './plansApi'
import { PlanWeek } from './PlanWeek'

/** The client's plan from the coach: this week, what comes next, and a recent change. */
export function MyPlanCard() {
  const { t } = useTranslation()
  const plan = useMyPlan(true)
  if (!plan.data) return null
  const current = plan.data.versions.find((v) => v.state === 'current')
  const upcoming = plan.data.versions.filter((v) => v.state === 'upcoming')
  const notice = changeNotice(plan.data, new Date())
  return (
    <Card title={t('coachSpace.myPlan.title')}>
      {notice && (
        <p role="status" className="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-sm">
          {t('coachSpace.myPlan.changed', { date: planDate(notice.valid_from) })}{notice.reason ? `: „${notice.reason}“` : ''}
        </p>
      )}
      {current ? <PlanWeek version={current} highlightToday /> : <p className="text-muted">{t('coachSpace.plan.noneNow')}</p>}
      {upcoming.map((version) => (
        <div key={version.id} className="mt-3 border-t border-line pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('coachSpace.plan.upcoming')}</p>
          <PlanWeek version={version} />
        </div>
      ))}
      <p className="mt-3 text-xs text-muted">{t('coachSpace.myPlan.hint')}</p>
    </Card>
  )
}
