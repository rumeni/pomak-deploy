import { useTranslation } from 'react-i18next'

import { formatDecimal } from '../../lib/format'
import type { CoachClientDetails } from './api'

type NutritionDay = NonNullable<CoachClientDetails['nutrition_days']>[number]

/** Render only known macro sums, with explicit counts of missing food values. */
export function CoachNutritionDays({ days }: { days: NutritionDay[] }) {
  const { t } = useTranslation()
  const macros = ([
    ['protein_g', 'protein_unknown', 'protein'],
    ['carbs_g', 'carbs_unknown', 'carbs'],
    ['fat_g', 'fat_unknown', 'fat'],
  ] as const)

  return (
    <>
      {days.map((day) => {
        // Old backend deployments may not yet contain the new count fields.
        const hasUnknown = macros.some(([, count]) => (day[count] ?? 0) > 0)
        return (
          <div key={day.date} className="border-b border-line py-2 text-sm last:border-0">
            <p>{day.date}: <strong>{Math.round(Number(day.kcal))} kcal</strong></p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted">
              {macros.map(([valueKey, unknownKey, label]) => (
                <span key={valueKey}>
                  {t(`nutrition.${label}`)}: {day[valueKey] === null ? '—' : `${formatDecimal(Number(day[valueKey]))} g`}
                  {(day[unknownKey] ?? 0) > 0 && (
                    <span className="ml-1">· {t('diary.unknownMacro', { count: day[unknownKey] })}</span>
                  )}
                </span>
              ))}
            </div>
            {hasUnknown && <p className="mt-1 text-xs text-muted">{t('diary.unknownNote')}</p>}
          </div>
        )
      })}
    </>
  )
}
