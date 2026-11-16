import { describe, expect, it } from 'vitest'
import { MAX_SAVED_MEAL_ITEMS, MAX_SAVED_MEAL_NAME_LENGTH, savedMealDraftIssue, withRetryMealId } from './savedMealValidation'

describe('saving a meal after a lost response', () => {
  it('reuses the original ID while retrying, including if the name changes', () => {
    const original = withRetryMealId(null, 'original-uuid', 'Breakfast', ['eggs'])
    const retried = withRetryMealId(original.id, 'new-uuid', 'Breakfast updated', ['eggs', 'toast'])
    expect(retried).toEqual({ id: 'original-uuid', name: 'Breakfast updated', items: ['eggs', 'toast'] })
    expect(withRetryMealId(null, 'new-uuid', 'New meal', [])).toHaveProperty('id', 'new-uuid')
  })
})

describe('saved meal creation uses API limits before the network call', () => {
  it('allows an exactly 100-character name, rejects 101 characters', () => {
    expect(savedMealDraftIssue('X'.repeat(MAX_SAVED_MEAL_NAME_LENGTH), 1)).toBeNull()
    expect(savedMealDraftIssue('X'.repeat(MAX_SAVED_MEAL_NAME_LENGTH + 1), 1)).toBe('nameTooLong')
  })

  it('counts Unicode code points like the Django serializer, not UTF-16 units', () => {
    expect(savedMealDraftIssue('A'.repeat(99) + '🍎', 1)).toBeNull()
    expect(savedMealDraftIssue('A'.repeat(100) + '🍎', 1)).toBe('nameTooLong')
    expect(savedMealDraftIssue('🍎'.repeat(100), 1)).toBeNull()
    expect(savedMealDraftIssue('🍎'.repeat(101), 1)).toBe('nameTooLong')
  })

  it('allows exactly 30 entries, rejects 31 and prioritizes name validation', () => {
    expect(savedMealDraftIssue('Lunch', MAX_SAVED_MEAL_ITEMS)).toBeNull()
    expect(savedMealDraftIssue('Lunch', MAX_SAVED_MEAL_ITEMS + 1)).toBe('tooManyItems')
    expect(savedMealDraftIssue('X'.repeat(101), 31)).toBe('nameTooLong')
  })
})
