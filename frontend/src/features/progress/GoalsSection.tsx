import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { formatDecimal, formatShortDate } from '../../lib/format'
import { useCloseGoal, useGoals, type Goal } from './api'

const unitOf = (goal: Goal) => (goal.kind === 'weight' ? 'kg' : 'cm')

/** Ciljevi napretka: aktivni sa stanjem, raniji ispod. */
export function GoalsSection() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useGoals()
  const close = useCloseGoal()
  const active = data?.filter((g) => g.status === 'active') ?? []
  const closed = data?.filter((g) => g.status !== 'active') ?? []

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t('progress.goals')}</h2>
        <Link to="/napredak/ciljevi/novi" className="-my-2 flex min-h-11 items-center px-1 text-sm font-semibold text-brand-dark">
          {t('progress.newGoal')}
        </Link>
      </div>
      {isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {isError && <p className="text-danger">{t('progress.loadFailed')}</p>}
      {data && !active.length && <p className="text-sm text-muted">{t('progress.noGoals')}</p>}
      {active.map((goal) => (
        <ActiveGoal key={goal.id} goal={goal} onClose={(status) => close.mutate({ id: goal.id, status })} pending={close.isPending} />
      ))}
      <FormError message={close.isError ? errorMessage(close.error) : null} />
      {closed.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-dark">{t('progress.pastGoals', { count: closed.length })}</summary>
          <ul className="flex flex-col gap-1">
            {closed.map((goal) => (
              <li key={goal.id} className="flex justify-between gap-3 rounded-xl bg-card px-4 py-2 text-sm ring-1 ring-line/60">
                <span>
                  {t(`progress.goalKind_${goal.kind}`)}: {goalTarget(goal, t)}
                </span>
                <span className="text-muted">
                  {t(`progress.goalStatus_${goal.status}`)} {goal.closed_on && formatShortDate(goal.closed_on)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function goalTarget(goal: Goal, t: (key: string, o?: Record<string, unknown>) => string): string {
  if (goal.kind === 'workouts_per_week') return t('progress.perWeek', { count: Number(goal.target_value) })
  return `${formatDecimal(Number(goal.start_value))} → ${formatDecimal(Number(goal.target_value))} ${unitOf(goal)}`
}

function ActiveGoal({ goal, onClose, pending }: { goal: Goal; onClose: (status: 'achieved' | 'abandoned') => void; pending: boolean }) {
  const { t } = useTranslation()
  const s = goal.state
  const workouts = goal.kind === 'workouts_per_week'
  const confirmStop = () => {
    if (window.confirm(t('progress.stopGoalConfirm'))) onClose('abandoned')
  }

  return (
    <Card>
      {!workouts && <p className="text-sm font-medium text-muted">{t(`progress.goalKind_${goal.kind}`)}</p>}
      <p className="text-lg font-semibold tabular-nums">{goalTarget(goal, t)}</p>
      <p className="mt-1 text-sm tabular-nums">
        {workouts
          ? t('progress.thisWeekCount', { count: Number(s.current), target: Number(goal.target_value) })
          : s.current === null
            ? t('progress.noCurrent')
            : t('progress.currentValue', { value: `${formatDecimal(Number(s.current))} ${unitOf(goal)}`, date: formatShortDate(s.current_date!) })}
      </p>
      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s.progress * 100)}
        aria-label={t(`progress.goalKind_${goal.kind}`)}
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(s.progress * 100)}%` }} />
      </div>
      {s.recent_weeks && (
        <p className="mt-2 text-xs text-muted">
          {t('progress.recentWeeks')}{' '}
          {s.recent_weeks.map((w, i) => (
            <span key={w.week_start} className={`font-semibold ${w.met ? 'text-brand-dark' : ''}`}>
              {i > 0 && <span className="font-normal"> · </span>}
              {w.count}
              {w.met ? ' ✓' : ''}
            </span>
          ))}
        </p>
      )}
      {goal.target_date && <p className="mt-1 text-xs text-muted">{t('progress.until', { date: formatShortDate(goal.target_date) })}</p>}
      {s.reached && !workouts && <p className="mt-2 rounded-xl bg-brand-soft p-3 text-sm text-brand-dark">{t('progress.reached')}</p>}
      <div className="mt-3 flex gap-2">
        {!workouts && (
          <Button variant={s.reached ? 'primary' : 'secondary'} className="flex-1" onClick={() => onClose('achieved')} disabled={pending}>
            {t('progress.markAchieved')}
          </Button>
        )}
        <Button variant="ghost" className="flex-1" onClick={confirmStop} disabled={pending}>
          {t('progress.stopGoal')}
        </Button>
      </div>
    </Card>
  )
}
