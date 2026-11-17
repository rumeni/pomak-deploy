import { useTranslation } from 'react-i18next'

import { LEVEL_SET, SCALE_FIELDS, readinessBand, readinessScore, sleepLabel, type Readiness } from './rpe'

/** Read-only check-in on a finished workout. */
export function ReadinessSummary({ readiness }: { readiness: Readiness }) {
  const { t } = useTranslation()
  const score = readinessScore(readiness)
  const band = score === null ? null : readinessBand(score)
  const rows = [
    readiness.sleep_hours !== null
      ? [t('readiness.sleep'), `${sleepLabel(readiness.sleep_hours)} h`]
      : null,
    ...SCALE_FIELDS.map(({ field }) => {
      const value = readiness[field]
      return value === null ? null : [t(`readiness.${field}`), t(`readiness.${LEVEL_SET[field]}.${value}`)]
    }),
  ].filter((row): row is string[] => row !== null)

  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('readiness.historyTitle')}</h2>
        {score !== null && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
            band === 'low' ? 'bg-danger/10 text-danger' : band === 'ok' ? 'bg-accent/15' : 'bg-brand text-white'
          }`}>
            {t('readiness.score', { value: score })}
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
