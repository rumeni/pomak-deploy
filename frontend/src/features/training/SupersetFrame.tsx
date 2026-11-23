import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Frame around the exercises of one superset or tri-set: "Superset A · A1 → A2, then rest." */
export function SupersetFrame({ labels, children }: { labels: string[]; children: ReactNode }) {
  const { t } = useTranslation()
  const letter = labels[0]?.charAt(0) ?? ''
  return (
    <section
      aria-label={t(labels.length > 2 ? 'routine.superset.triset' : 'routine.superset.title', { letter })}
      className="flex flex-col gap-2 rounded-3xl border-2 border-brand/35 bg-brand-soft/40 p-2"
    >
      <p className="flex flex-wrap items-baseline gap-x-2 px-2 pt-1 text-sm">
        <span className="font-bold text-brand-dark">
          {t(labels.length > 2 ? 'routine.superset.triset' : 'routine.superset.title', { letter })}
        </span>
        <span className="text-xs text-muted">{t('routine.superset.order', { order: labels.join(' → ') })}</span>
      </p>
      {children}
    </section>
  )
}

/** "A1" next to an exercise's name. */
export function SupersetBadge({ label }: { label: string | null }) {
  if (!label) return null
  return (
    <span className="mr-1.5 inline-flex min-w-7 items-center justify-center rounded-md bg-brand px-1.5 py-0.5 align-middle text-xs font-bold text-white">
      {label}
    </span>
  )
}
