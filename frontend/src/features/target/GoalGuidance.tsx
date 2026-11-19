import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { Goal } from './api'

/**
 * How to follow progress for a goal: indirect signs (waist, the weight trend, strength), never a
 * promised result or a body-fat estimate. Links go to screens the app already has.
 */
export function GoalGuidance({ goal }: { goal: Goal }) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="goal-guidance" className="rounded-2xl bg-brand-soft p-4 text-sm text-brand-dark">
      <h3 id="goal-guidance" className="font-semibold">{t('target.guidance.title')}</h3>
      <p className="mt-1">{t(`target.guidance.intro_${goal}`)}</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        <li>{t('target.guidance.waist')}</li>
        <li>{t('target.guidance.weightTrend')}</li>
        <li>{t('target.guidance.strength')}</li>
      </ul>
      <p className="mt-2 text-xs">{t('target.guidance.indirect')}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link to="/napredak/merenja" className="inline-flex min-h-11 items-center font-semibold underline">{t('target.guidance.measurements')}</Link>
        <Link to="/napredak/statistika" className="inline-flex min-h-11 items-center font-semibold underline">{t('target.guidance.stats')}</Link>
      </div>
    </section>
  )
}
