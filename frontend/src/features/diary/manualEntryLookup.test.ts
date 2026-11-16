import { describe, expect, it } from 'vitest'
import { findManualEntryForEdit } from './manualEntryLookup'
import type { DiaryEntry } from './types'

describe('manual entry deep-link validation', () => {
  it('never treats an absent edit target as an existing entry', () => {
    expect(findManualEntryForEdit('missing', { entries: [] })).toBeUndefined()
    expect(findManualEntryForEdit('missing', undefined)).toBeUndefined()
    expect(findManualEntryForEdit(null, { entries: [] })).toBeUndefined()
  })
  it('selects only the exact existing entry', () => {
    const row = { id: 'correct' } as DiaryEntry
    expect(findManualEntryForEdit('correct', { entries: [row] })).toBe(row)
    expect(findManualEntryForEdit('different', { entries: [row] })).toBeUndefined()
  })
})
