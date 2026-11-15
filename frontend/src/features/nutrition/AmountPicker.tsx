import { useTranslation } from 'react-i18next'

import { formatDecimal } from '../../lib/format'
import type { FoodPortion } from './api'

/** Količina u gramima: upis ili dodir na porciju ("1 jaje (veliko)" = 50 g). */
export function AmountPicker({
  value,
  portions,
  onChange,
}: {
  value: string
  portions: FoodPortion[]
  /** Nova količina i naziv porcije (prazan kad je upisano ručno). */
  onChange: (grams: string, portionName: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="amount" className="text-sm font-medium">
        {t('nutrition.amount')}
      </label>
      <input
        id="amount"
        value={value}
        onChange={(e) => onChange(e.target.value, '')}
        inputMode="decimal"
        className="min-h-12 w-full rounded-xl border border-line bg-card px-4 text-lg tabular-nums outline-none focus:border-brand"
      />
      <div className="flex flex-wrap gap-2">
        <Chip label="100 g" onClick={() => onChange('100', '')} />
        {portions.map((p) => (
          <Chip
            key={p.name}
            label={`${p.name} · ${formatDecimal(Number(p.grams))} g`}
            onClick={() => onChange(formatDecimal(Number(p.grams)), p.name)}
          />
        ))}
      </div>
    </div>
  )
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-10 rounded-full bg-card px-4 text-sm font-medium ring-1 ring-line active:bg-brand-soft">
      {label}
    </button>
  )
}
