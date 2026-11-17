import { describe, expect, it } from 'vitest'

import { mergeScan, safeLabelValues, type FoodDraft } from './scanMerge'

const empty: FoodDraft = { name: '', barcode: '', values: { kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' }, sourceRef: '' }
const nutella = {
  kind: 'barcode' as const, barcode: '3017620422003', name: 'Nutella (Ferrero)', sourceRef: 'openfoodfacts:3017620422003',
  values: { kcal: '539', protein_g: '6.3', carbs_g: '57.5', fat_g: '30.9', fiber_g: null },
}

describe('putting a scan into the food form', () => {
  it('fills a product from its barcode with its provenance', () => {
    const { next, filled, replaces } = mergeScan({ ...empty, name: 'nutela' }, nutella)
    expect(next).toEqual({
      name: 'Nutella (Ferrero)', barcode: '3017620422003', sourceRef: 'openfoodfacts:3017620422003',
      values: { kcal: '539', protein_g: '6,3', carbs_g: '57,5', fat_g: '30,9', fiber_g: '' },
    })
    expect(filled).toEqual(['kcal', 'protein_g', 'carbs_g', 'fat_g'])
    expect(replaces).toBe(false)
  })

  it('never mixes two products: a second barcode with fewer values starts over', () => {
    const first = mergeScan(empty, nutella).next
    const second = mergeScan(first, { kind: 'barcode', barcode: '5901234123457', name: 'Jogurt', values: { kcal: '61', protein_g: null, carbs_g: null, fat_g: null, fiber_g: null } })
    expect(second.next).toEqual({
      name: 'Jogurt', barcode: '5901234123457', sourceRef: '',
      values: { kcal: '61', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' },
    })
    expect(second.replaces).toBe(true)
  })

  it('clears the previous product when a new barcode is not found anywhere', () => {
    const first = mergeScan(empty, nutella).next
    const unknown = mergeScan(first, { kind: 'barcode', barcode: '5901234123457', values: {} })
    expect(unknown.next).toEqual({ ...empty, barcode: '5901234123457' })
    expect(unknown.replaces).toBe(true)
  })

  it('keeps typed values for the same, unknown product', () => {
    const typed = { ...empty, name: 'Moj jogurt', values: { ...empty.values, kcal: '60' } }
    expect(mergeScan(typed, { kind: 'barcode', barcode: '5901234123457', values: {} })).toEqual({
      next: { ...typed, barcode: '5901234123457' }, filled: [], replaces: false,
    })
  })

  it('a label photo fills only what it read and is the athlete\'s own reading', () => {
    const start = mergeScan(empty, nutella).next
    const { next, filled, replaces } = mergeScan(start, { kind: 'label', values: { fiber_g: '3.4' } })
    expect(next.values).toEqual({ ...start.values, fiber_g: '3,4' })
    expect(next.sourceRef).toBe('openfoodfacts:3017620422003')
    expect(filled).toEqual(['fiber_g'])
    expect(replaces).toBe(false)
  })

  it('retains Open Food Facts provenance after partially rereading the same label', () => {
    const start = mergeScan(empty, nutella).next
    const next = mergeScan(start, { kind: 'label', values: { fat_g: '31.2' } }).next
    expect(next.sourceRef).toBe('openfoodfacts:3017620422003')
    expect(next.values.protein_g).toBe('6,3')
  })

  it('prefills only an explicitly identified per-100-gram column', () => {
    const data = { values: { kcal: '80' }, found: ['kcal' as const], column: 'per100' as const, perMl: false }
    expect(safeLabelValues(data)).toEqual({ kcal: '80' })
    expect(safeLabelValues({ ...data, perMl: true })).toEqual({})
    expect(safeLabelValues({ ...data, column: 'assumed' })).toEqual({})
    expect(safeLabelValues({ ...data, column: 'servingOnly' })).toEqual({})
  })
})
