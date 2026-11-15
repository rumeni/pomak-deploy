import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getFormatLocale } from '../lib/format'

import { selectClass } from './ui'

/** Nazivi meseci na jeziku aplikacije ("januar" / "January"). */
function monthNames(): string[] {
  const fmt = new Intl.DateTimeFormat(getFormatLocale(), { month: 'long' })
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2000, i, 1)))
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * Datum rođenja kao tri izbora (dan, mesec, godina). Kalendar bi otvarao današnji datum,
 * pa bi korisnik morao da lista decenije unazad.
 * value/onChange koriste "YYYY-MM-DD" ili "" dok nije izabrano sve troje.
 */
export function DateOfBirthField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t, i18n } = useTranslation()
  // Srpski pravopis: redni broj sa tačkom ("20.", "1995.").
  const dot = i18n.language === 'en' ? '' : '.'
  const [initY, initM, initD] = value ? value.split('-').map(Number) : [0, 0, 0]
  const [year, setYear] = useState(initY)
  const [month, setMonth] = useState(initM)
  const [day, setDay] = useState(initD)

  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 100 }, (_, i) => thisYear - 10 - i)
  const maxDay = year && month ? daysInMonth(year, month) : 31

  const update = (y: number, m: number, d: number) => {
    const safeDay = y && m && d ? Math.min(d, daysInMonth(y, m)) : d
    setYear(y)
    setMonth(m)
    setDay(safeDay)
    onChange(y && m && safeDay ? `${y}-${String(m).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}` : '')
  }

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{t('dateOfBirth.label')}</legend>
      <div className="grid grid-cols-[1fr_2fr_1.4fr] gap-2">
        <select aria-label={t('dateOfBirth.day')} className={selectClass} value={day || ''} onChange={(e) => update(year, month, Number(e.target.value))}>
          <option value="">{t('dateOfBirth.day')}</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
              {dot}
            </option>
          ))}
        </select>
        <select aria-label={t('dateOfBirth.month')} className={selectClass} value={month || ''} onChange={(e) => update(year, Number(e.target.value), day)}>
          <option value="">{t('dateOfBirth.month')}</option>
          {monthNames().map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label={t('dateOfBirth.year')} className={selectClass} value={year || ''} onChange={(e) => update(Number(e.target.value), month, day)}>
          <option value="">{t('dateOfBirth.year')}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
              {dot}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  )
}
