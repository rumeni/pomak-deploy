import { useTranslation } from 'react-i18next'

import { Button, ScreenHeader } from '../../components/ui'
import {
  EMPTY_READINESS,
  SCALE_FIELDS,
  LEVEL_SET,
  SLEEP_OPTIONS,
  hasReadiness,
  readinessBand,
  readinessScore,
  sleepLabel,
  type Readiness,
} from './rpe'

const BAND_CLASS = {
  low: 'bg-danger/10 text-danger',
  ok: 'bg-accent/15 text-ink',
  high: 'bg-brand text-white',
} as const

function ScorePill({ readiness }: { readiness: Readiness | undefined }) {
  const { t } = useTranslation()
  const score = readinessScore(readiness)
  if (score === null) return null
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${BAND_CLASS[readinessBand(score)]}`}>
      {t('readiness.score', { value: score })}
    </span>
  )
}

/**
 * Pre-workout check-in as its own step: the first thing after "Start", sized to fit one
 * phone screen, with Skip and Start at the bottom. Reopened from the workout to edit.
 */
export function ReadinessStep({
  title,
  readiness,
  editing,
  onChange,
  onBack,
  onSkip,
  onDone,
}: {
  title: string
  readiness: Readiness | undefined
  /** Reopened during the workout: one "Done" button instead of Skip / Start. */
  editing: boolean
  onChange: (next: Readiness) => void
  onBack: () => void
  onSkip: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const values = readiness ?? EMPTY_READINESS

  const set = <K extends keyof Readiness>(field: K, value: Readiness[K]) =>
    onChange({ ...values, [field]: values[field] === value ? null : value })

  const choice = (selected: boolean) =>
    `min-h-10 rounded-lg text-sm [@media(max-height:700px)]:min-h-[38px] font-semibold tabular-nums ${selected ? 'bg-brand text-white' : 'bg-card ring-1 ring-line'}`

  return (
    <div className="flex h-dvh flex-col">
      <ScreenHeader title={title} onBack={onBack} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {/* Short phones: tighter spacing and no subtitle, so all of it fits without scrolling. */}
        <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-3 [@media(max-height:700px)]:gap-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl">{t('readiness.title')}</h1>
              <p className="text-sm text-muted [@media(max-height:700px)]:hidden">{t('readiness.intro')}</p>
            </div>
            <ScorePill readiness={readiness} />
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('readiness.sleep')}</legend>
            <div className="grid grid-cols-7 gap-1">
              {SLEEP_OPTIONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={values.sleep_hours === h}
                  aria-label={t('readiness.sleepValue', { value: sleepLabel(h) })}
                  onClick={() => set('sleep_hours', h)}
                  className={choice(values.sleep_hours === h)}
                >
                  {sleepLabel(h)}
                </button>
              ))}
            </div>
          </fieldset>

          {SCALE_FIELDS.map(({ field }, i) => {
            const value = values[field]
            const levels = LEVEL_SET[field]
            return (
              <fieldset key={field}>
                <legend className="mb-1 flex w-full items-baseline justify-between gap-2 text-sm font-medium">
                  <span>{t(`readiness.${field}`)}</span>
                  <span className="text-xs font-normal text-muted">
                    {value !== null ? t(`readiness.${levels}.${value}`) : i === 0 ? `1 ${t('readiness.scaleLow')} · 5 ${t('readiness.scaleHigh')}` : ''}
                  </span>
                </legend>
                <div className="grid grid-cols-5 gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={value === n}
                      aria-label={`${t(`readiness.${field}`)}: ${t(`readiness.${levels}.${n}`)}`}
                      onClick={() => set(field, n)}
                      className={choice(value === n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </fieldset>
            )
          })}
        </div>
      </main>
      <footer className="pb-safe border-t border-line bg-surface">
        <div className="mx-auto flex max-w-xl gap-2 px-4 py-3">
          {editing ? (
            <Button className="flex-1" onClick={onDone}>{t('readiness.done')}</Button>
          ) : (
            <>
              <Button variant="secondary" className="flex-1" onClick={onSkip}>{t('readiness.skip')}</Button>
              <Button className="flex-[2]" onClick={onDone}>{t('readiness.start')}</Button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}

/** One line at the top of the workout: the score and a way back into the check-in. */
export function ReadinessRow({ readiness, onOpen }: { readiness: Readiness | undefined; onOpen: () => void }) {
  const { t } = useTranslation()
  const answered = hasReadiness(readiness)
  const summary = answered
    ? [
        readiness.sleep_hours !== null ? t('readiness.sleepValue', { value: sleepLabel(readiness.sleep_hours) }) : null,
        readiness.motivation !== null ? `${t('readiness.motivation')}: ${t(`readiness.levelF.${readiness.motivation}`).toLowerCase()}` : null,
      ].filter(Boolean).join(' · ')
    : t('readiness.notFilled')
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-card px-4 py-2 text-left shadow-sm ring-1 ring-line/60"
    >
      {answered ? <ScorePill readiness={readiness} /> : <span className="font-semibold">{t('readiness.title')}</span>}
      <span className="min-w-0 flex-1 truncate text-sm text-muted">{summary}</span>
      <span className="shrink-0 text-sm font-semibold text-brand-dark">{answered ? t('readiness.edit') : t('readiness.fill')}</span>
    </button>
  )
}
