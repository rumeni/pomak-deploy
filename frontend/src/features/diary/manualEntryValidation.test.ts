import { describe, expect, it } from 'vitest'
import { manualEntry } from './model'
import { parseManualValue, type ManualValueField } from './manualEntryValidation'

const macros: ManualValueField[] = ['protein_g', 'carbs_g', 'fat_g', 'fiber_g']

describe('offline manual food values use API limits', () => {
  it('allows the exact minimum and maximum calorie boundaries', () => {
    expect(parseManualValue('kcal', '0')).toEqual({ ok: true, value: '0' })
    expect(parseManualValue('kcal', '10 000,0')).toEqual({ ok: true, value: '10000' })
    expect(parseManualValue('kcal', '10 000,1')).toMatchObject({ ok: false, error: 'range' })
  })

  it.each(macros)('%s allows known values through 1000 and retains unknown as null', (field) => {
    expect(parseManualValue(field, '1000,00')).toEqual({ ok: true, value: '1000' })
    expect(parseManualValue(field, '')).toEqual({ ok: true, value: null })
    expect(parseManualValue(field, '1000.01')).toMatchObject({ ok: false, error: 'range' })
  })

  it('rejects values that would otherwise be silently rounded', () => {
    expect(parseManualValue('kcal', '10,25')).toMatchObject({ ok: false, error: 'precision' })
    expect(parseManualValue('protein_g', '20.123')).toMatchObject({ ok: false, error: 'precision' })
    expect(parseManualValue('fiber_g', '1,25')).toEqual({ ok: true, value: '1.25' })
  })

  it('rejects nonnumeric, negative, and ambiguous thousands separators', () => {
    for (const text of ['-1', 'a', '1.234,5', '1,2,3']) {
      expect(parseManualValue('kcal', text)).toMatchObject({ ok: false, error: 'invalid' })
    }
  })

  it('preserves optional fiber in the saved draft when editing a manual entry', () => {
    const fiber = parseManualValue('fiber_g', '7,5')
    if (!fiber.ok) throw new Error('Fiber must be valid')
    const draft = manualEntry('e1', '2026-11-16', 'lunch', 'Burek', {
      kcal: '350', protein_g: null, carbs_g: null, fat_g: null, fiber_g: fiber.value,
    }, new Date('2026-11-16T12:00:00Z'))
    expect(draft.body.fiber_g).toBe('7.50')
    expect(draft.preview.fiber_g).toBe('7.50')
  })
})
