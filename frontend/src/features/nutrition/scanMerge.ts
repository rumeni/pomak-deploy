import type { LabelField, LabelValues } from './labelText'

export type ValueField = LabelField

export interface FoodDraft {
  name: string
  barcode: string
  values: Record<ValueField, string>
  /** Provenance of the values ("openfoodfacts:<code>"), '' when typed or read from the label. */
  sourceRef: string
}

export interface ScanData {
  kind: 'barcode' | 'label'
  barcode?: string
  name?: string
  values: Partial<Record<ValueField, string | null>>
  sourceRef?: string
}

const FIELDS: ValueField[] = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']
const display = (v: string | null | undefined) => (v === null || v === undefined ? '' : v.replace('.', ','))

/** The nutrition form stores grams, never silently treat millilitres as grams.
 * A missing header is ambiguous and requires manual confirmation/entry. */
export function safeLabelValues(label: LabelValues): LabelValues['values'] {
  return label.column === 'per100' && !label.perMl ? label.values : {}
}

/**
 * Puts a scan into the form without ever mixing two products.
 *
 * - A barcode of a different product than the one in the form starts over: name, values and
 *   provenance all come from the new product (blank where it has none).
 * - Product data for the same barcode (Open Food Facts) replaces the values as a whole, too.
 * - A label photo is the same product: only the values it read are filled, the rest stays.
 *
 * `replaces` says the form had values of its own that this would overwrite or clear, so the
 * athlete can be asked first.
 */
export function mergeScan(current: FoodDraft, scan: ScanData): { next: FoodDraft; filled: ValueField[]; replaces: boolean } {
  const hasValues = FIELDS.some((f) => current.values[f].trim())
  if (scan.kind === 'label') {
    const filled = FIELDS.filter((f) => scan.values[f] !== null && scan.values[f] !== undefined)
    const values = { ...current.values }
    for (const f of filled) values[f] = display(scan.values[f])
    return {
      next: { ...current, values, sourceRef: current.sourceRef },
      filled,
      replaces: filled.some((f) => current.values[f].trim() && current.values[f] !== values[f]),
    }
  }

  const code = scan.barcode ?? ''
  const otherProduct = !!code && !!current.barcode && code !== current.barcode
  const hasData = !!scan.name || FIELDS.some((f) => scan.values[f] !== null && scan.values[f] !== undefined)
  if (!otherProduct && !hasData) {
    // Unknown product, same (or first) barcode: keep what was typed for it.
    return { next: { ...current, barcode: code || current.barcode }, filled: [], replaces: false }
  }
  const values = Object.fromEntries(FIELDS.map((f) => [f, display(scan.values[f])])) as Record<ValueField, string>
  return {
    next: {
      name: scan.name || (otherProduct ? '' : current.name),
      barcode: code,
      values,
      sourceRef: scan.sourceRef ?? '',
    },
    filled: FIELDS.filter((f) => values[f]),
    replaces: hasValues || (otherProduct && !!current.name.trim()),
  }
}

/**
 * A barcode typed by hand, checked when the field is left (not on every digit), with the same
 * rule as a scan: content in the form belongs to the product of `productBarcode`.
 * - 'same': nothing changed.
 * - 'first': the draft had no barcode yet; the typed one simply belongs to it.
 * - 'other': it had one and now another - possibly a different product. The athlete decides:
 *   a different product starts from `forNewProduct`, a corrected typo keeps the content.
 */
export function barcodeEdit(current: FoodDraft, productBarcode: string, typed: string): 'same' | 'first' | 'other' {
  const code = typed.trim()
  if (code === productBarcode) return 'same'
  if (!productBarcode) return 'first'
  const hasContent = !!current.name.trim() || !!current.sourceRef || FIELDS.some((f) => current.values[f].trim())
  return hasContent ? 'other' : 'first'
}

/** A clean draft for another product: nothing of the previous one is kept. */
export function forNewProduct(barcode: string): FoodDraft {
  return { name: '', barcode, values: Object.fromEntries(FIELDS.map((f) => [f, ''])) as Record<ValueField, string>, sourceRef: '' }
}

