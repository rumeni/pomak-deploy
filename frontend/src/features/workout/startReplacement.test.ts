import { describe, expect, it, vi } from 'vitest'
import { startConfirmedReplacement } from './startReplacement'

describe('rest notification during workout replacement', () => {
  it('does not cancel an alarm when another tab wins', async () => {
    const cancel = vi.fn(async () => undefined)
    expect(await startConfirmedReplacement(async () => false, true, cancel)).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })
  it('cancels the prior alarm only after the replacement succeeds', async () => {
    const order: string[] = []
    expect(await startConfirmedReplacement(async () => {
      order.push('start')
      return true
    }, true, async () => { order.push('cancel') })).toBe(true)
    expect(order).toEqual(['start', 'cancel'])
  })
  it('does not cancel an unrelated alarm for the initial workout', async () => {
    const cancel = vi.fn(async () => undefined)
    expect(await startConfirmedReplacement(async () => true, false, cancel)).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
  })
})
