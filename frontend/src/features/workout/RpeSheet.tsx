import { useTranslation } from 'react-i18next'

import { BottomSheet } from '../../components/BottomSheet'
import { formatRpe, repsInReserve, rpeChoices } from './rpe'

/** What an RPE value means, in reps left in reserve. */
function useRpeDescription() {
  const { t } = useTranslation()
  return (rpe: number) => {
    if (rpe >= 10) return t('rpe.desc10')
    if (rpe === 9.5) return t('rpe.desc95')
    const rir = repsInReserve(rpe)!
    return rir.min === rir.max ? t('rpe.descLeft', { count: rir.min }) : t('rpe.descRange', { min: rir.min, max: rir.max })
  }
}

/** Bottom sheet with the RPE scale. Picking a value closes it; tapping outside or ✕ just closes. */
export function RpeSheet({
  title,
  value,
  target,
  onPick,
  onClose,
}: {
  title: string
  value: number | null
  target: number | null
  onPick: (rpe: number | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const describe = useRpeDescription()

  return (
    <BottomSheet
      label={title}
      kicker={title}
      title={t('rpe.sheetTitle')}
      onClose={onClose}
      // Keyboard focus starts on the current value, or the planned one.
      initialFocus={(root) => root.querySelector<HTMLElement>('[aria-pressed="true"]') ?? root.querySelector<HTMLElement>('[data-planned]')}
    >
      <p className="mt-1 text-sm text-muted">{t('rpe.sheetIntro')}</p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {rpeChoices(value, target).map((rpe) => {
          const selected = value === rpe
          return (
            <li key={rpe}>
              <button
                type="button"
                aria-pressed={selected}
                data-planned={target === rpe || undefined}
                onClick={() => onPick(rpe)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left ring-1 ${
                  selected ? 'bg-brand text-white ring-brand' : 'bg-card ring-line/70 active:bg-brand-soft'
                }`}
              >
                <span className="font-display w-10 shrink-0 text-xl tabular-nums">{formatRpe(rpe)}</span>
                <span className={`flex-1 text-sm ${selected ? 'text-white/85' : 'text-muted'}`}>{describe(rpe)}</span>
                {target === rpe && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${selected ? 'bg-white/20' : 'bg-accent/15 text-ink'}`}>
                    {t('rpe.planned')}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {value !== null && (
        <button type="button" onClick={() => onPick(null)} className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-muted active:bg-line">
          {t('rpe.clear')}
        </button>
      )}
    </BottomSheet>
  )
}
