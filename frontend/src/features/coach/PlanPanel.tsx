import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { useClientGuard } from './guard'
import { useClientPlan } from './plansApi'
import { PlanWeek } from './PlanWeek'

/** The coach's view of a client's plan: current and upcoming versions, recent history. */
export function PlanPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const plan = useClientPlan(clientId)
  const guard = useClientGuard(clientId, plan)
  if (guard.state === 'revoked') return null
  const data = plan.data?.plan
  const versions = data?.versions ?? []
  const current = versions.find((v) => v.state === 'current')
  const upcoming = versions.filter((v) => v.state === 'upcoming')
  const past = versions.filter((v) => v.state === 'past').reverse()
  return (
    <Card title={t('coachSpace.plan.title')}>
      {plan.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {plan.isError && !plan.data && (
        <>
          <FormError message={t('errors.loadFailed')} />
          <Button variant="secondary" className="mt-2" onClick={() => void plan.refetch()}>{t('common.retry')}</Button>
        </>
      )}
      {plan.data && data === null && <p className="text-muted">{t('coachSpace.plan.none')}</p>}
      {data && !current && upcoming.length === 0 && <p className="text-muted">{t('coachSpace.plan.noneNow')}</p>}
      {current && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('coachSpace.plan.current')}</p>
          <PlanWeek version={current} highlightToday />
        </div>
      )}
      {upcoming.map((version) => (
        <div key={version.id} className="mb-3 border-t border-line pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('coachSpace.plan.upcoming')}</p>
          <PlanWeek version={version} />
        </div>
      ))}
      <div className="mt-2 flex flex-wrap gap-2">
        <Link to={`/trener/klijenti/${clientId}/plan`} className="app-button app-button-primary inline-flex min-h-10 items-center bg-brand px-4 text-sm text-white">
          {data ? t('coachSpace.plan.change') : t('coachSpace.plan.create')}
        </Link>
        <Link to={`/trener/programi/dodela?klijent=${clientId}`} className="app-button inline-flex min-h-10 items-center bg-brand-soft px-4 text-sm text-brand-dark">
          {t('coachSpace.plan.assignProgram')}
        </Link>
      </div>
      {past.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">{t('coachSpace.plan.history', { count: past.length })}</summary>
          <div className="mt-2 flex flex-col gap-3">
            {past.map((version) => <div key={version.id} className="border-t border-line pt-2 opacity-80"><PlanWeek version={version} /></div>)}
          </div>
        </details>
      )}
    </Card>
  )
}
