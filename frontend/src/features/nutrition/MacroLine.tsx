import { useTranslation } from 'react-i18next'

import { formatDecimal } from '../../lib/format'

/** Broj za prikaz, zaokružen na jednu decimalu; nepoznata vrednost je "?" (nikad 0). */
export function fmtValue(value: number | string | null): string {
  return value === null ? '?' : formatDecimal(Math.round(Number(value) * 10) / 10)
}

/** "P 12,6 · UH 0,7 · M 9,5" */
export function MacroLine({ protein, carbs, fat }: { protein: number | string | null; carbs: number | string | null; fat: number | string | null }) {
  const { t } = useTranslation()
  return (
    <span className="tabular-nums">
      {t('nutrition.proteinShort')} {fmtValue(protein)} · {t('nutrition.carbsShort')} {fmtValue(carbs)} · {t('nutrition.fatShort')} {fmtValue(fat)}
    </span>
  )
}
