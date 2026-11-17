import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { lookupBarcode, type Food } from './api'
import type { LabelField } from './labelText'

export interface ScanResult {
  barcode?: string
  /** The product is already in the database. */
  food?: Food
  name?: string
  values: Partial<Record<LabelField, string | null>>
  /** What happened, for the athlete (what was read, what to check). */
  note: string | null
}

/**
 * Two ways to fill the form from the package: the barcode (our database, then Open Food Facts)
 * or a photo of the nutrition table (read on the phone). Both open the camera on a phone and a
 * file picker on a computer. Values are only suggestions; the athlete confirms them.
 */
export function FoodScanner({ onResult, autoStart = false }: { onResult: (result: ScanResult) => void; autoStart?: boolean }) {
  const { t } = useTranslation()
  const barcodeInput = useRef<HTMLInputElement>(null)
  const labelInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const fieldName = (f: LabelField) => t(f === 'kcal' ? 'nutrition.kcal' : `nutrition.${f.replace('_g', '')}`)

  const onBarcode = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(t('scan.readingBarcode'))
    try {
      const { readBarcode } = await import('./scan')
      const code = await readBarcode(file)
      if (!code) return onResult({ values: {}, note: t('scan.barcodeNotRead') })
      if (!navigator.onLine) return onResult({ barcode: code, values: {}, note: t('scan.barcodeOffline', { code }) })
      setBusy(t('scan.lookingUp', { code }))
      const { food, suggestion } = await lookupBarcode(code)
      if (food) return onResult({ barcode: code, food, values: {}, note: null })
      if (suggestion) {
        const { name, barcode, source: _source, ...values } = suggestion
        return onResult({ barcode, name, values, note: t('scan.fromOpenFoodFacts') })
      }
      onResult({ barcode: code, values: {}, note: t('scan.barcodeUnknown', { code }) })
    } catch {
      onResult({ values: {}, note: t('scan.failed') })
    } finally {
      setBusy(null)
    }
  }

  const onLabel = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(t('scan.readingLabel', { percent: 0 }))
    try {
      const { readNutritionLabel } = await import('./scan')
      const { values, found } = await readNutritionLabel(file, (share) => setBusy(t('scan.readingLabel', { percent: Math.round(share * 100) })))
      if (!found.length) return onResult({ values: {}, note: t('scan.labelNotRead') })
      const missing = (['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'] as LabelField[]).filter((f) => !found.includes(f))
      onResult({
        values,
        note: [
          t('scan.labelRead', { fields: found.map(fieldName).join(', ') }),
          missing.length ? t('scan.labelMissing', { fields: missing.map(fieldName).join(', ') }) : null,
        ].filter(Boolean).join(' '),
      })
    } catch {
      onResult({ values: {}, note: navigator.onLine ? t('scan.failed') : t('scan.labelOffline') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={`rounded-2xl bg-ink p-4 text-white ${autoStart ? 'ring-2 ring-accent' : ''}`} aria-labelledby="scan-title">
      <h2 id="scan-title" className="font-display text-xl">{t('scan.title')}</h2>
      <p className="mt-0.5 text-sm text-white/70">{t('scan.intro')}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => barcodeInput.current?.click()}
          className="flex min-h-14 flex-col items-center justify-center rounded-xl bg-white/10 px-2 text-sm font-semibold active:bg-white/20 disabled:opacity-50"
        >
          <span aria-hidden className="text-lg">▥</span>
          {t('scan.barcode')}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => labelInput.current?.click()}
          className="flex min-h-14 flex-col items-center justify-center rounded-xl bg-accent px-2 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50"
        >
          <span aria-hidden className="text-lg">▤</span>
          {t('scan.label')}
        </button>
      </div>
      {busy && <p className="mt-3 text-sm text-white/80" role="status">{busy}</p>}
      <input ref={barcodeInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onBarcode(e)} />
      <input ref={labelInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onLabel(e)} />
    </section>
  )
}
