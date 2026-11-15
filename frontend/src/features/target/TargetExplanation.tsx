import { useTranslation } from 'react-i18next'

import { formatDecimal, formatShortDate } from '../../lib/format'
import type { Explanation, TargetInputs } from './api'

const n = (value: number) => formatDecimal(value)

/** Proračun korak po korak, da korisnik vidi odakle je cilj (AC-06). */
export function TargetExplanation({
  kcal,
  protein,
  carbs,
  fat,
  inputs,
  explanation,
}: {
  kcal: number
  protein: number | null
  carbs: number | null
  fat: number | null
  inputs: TargetInputs
  explanation: Explanation
}) {
  const { t } = useTranslation()
  const e = explanation
  const data = t('target.inputsLine', {
    sex: t(`onboarding.${inputs.sex}`),
    age: inputs.age,
    height: n(inputs.height_cm),
    weight: n(inputs.weight_kg),
    date: formatShortDate(inputs.weight_date),
  })
  const steps: [string, string][] = [
    [t('target.stepBmr'), `${n(e.bmr)} kcal`],
    [t('target.stepActivity', { activity: t(`target.activity_${inputs.activity}`) }), `× ${n(e.activity_factor)} = ${n(e.tdee)} kcal`],
    [
      t('target.stepPace'),
      e.daily_adjustment === 0
        ? t('target.noAdjustment')
        : t('target.adjustmentLine', { kcal: `${e.daily_adjustment > 0 ? '+' : '−'}${n(Math.abs(e.daily_adjustment))}`, kg: n(Math.abs(e.weekly_change_kg)) }),
    ],
    [t('target.stepRounded'), `${n(kcal)} kcal`],
  ]
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        <span className="text-muted">{t('target.stepInputs')}: </span>
        <span className="font-medium">{data}</span>
      </p>
      <ol className="flex flex-col">
        {steps.map(([label, value], i) => (
          <li key={label} className="flex justify-between gap-3 border-b border-line py-2 last:border-0">
            <span className="text-muted">
              {i + 1}. {label}
            </span>
            <span className="text-right font-medium tabular-nums">{value}</span>
          </li>
        ))}
      </ol>
      <p className="text-muted">
        {t('target.macrosLine', {
          protein: protein === null ? '?' : n(protein),
          perKg: n(e.protein_g_per_kg),
          fat: fat === null ? '?' : n(fat),
          fatShare: Math.round(e.fat_share * 100),
          carbs: carbs === null ? '?' : n(carbs),
        })}
      </p>
    </div>
  )
}
