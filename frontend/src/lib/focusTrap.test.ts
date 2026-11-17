import { describe, expect, it } from 'vitest'

import { nextFocusTarget } from './focusTrap'

describe('modal focus trap', () => {
  const items = ['close', 'rpe-10', 'rpe-9', 'clear']

  it('wraps Tab from the last control to the first', () => {
    expect(nextFocusTarget(items, 'clear', false)).toBe('close')
  })

  it('wraps Shift+Tab from the first control to the last', () => {
    expect(nextFocusTarget(items, 'close', true)).toBe('clear')
  })

  it('leaves movement inside the dialog to the browser', () => {
    expect(nextFocusTarget(items, 'rpe-10', false)).toBeNull()
    expect(nextFocusTarget(items, 'rpe-9', true)).toBeNull()
  })

  it('pulls focus back in when it is outside the dialog', () => {
    expect(nextFocusTarget(items, 'finish-workout', false)).toBe('close')
    expect(nextFocusTarget(items, null, true)).toBe('clear')
    expect(nextFocusTarget([], 'x', false)).toBeNull()
  })
})
