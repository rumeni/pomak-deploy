import { afterEach, describe, expect, it } from 'vitest'

import { setFormatLocale } from '../../lib/format'
import { foodFormValue } from './foodFormValues'

afterEach(() => setFormatLocale('sr-Latn-RS'))

describe('food input decimals', () => {
  it('uses a comma in Serbian and preserves zero and optional blanks', () => {
    setFormatLocale('sr-Latn-RS')
    expect(foodFormValue('95.50')).toBe('95,5')
    expect(foodFormValue('0.00')).toBe('0')
    expect(foodFormValue(null)).toBe('')
  })

  it('uses a dot in English', () => {
    setFormatLocale('en')
    expect(foodFormValue('95.50')).toBe('95.5')
  })
})
