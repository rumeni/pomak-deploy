import { describe, expect, it } from 'vitest'

import { chatScrollTop, nearChatBottom } from './chatScroll'

describe('coach message scroll regression (#48)', () => {
  it('opens a long conversation at the newest message', () => {
    expect(chatScrollTop({ previousCount: 0, count: 80, previousNewestId: null, newestId: 'old', nearBottom: true, scrollHeight: 3000, restore: null })).toBe(3000)
  })

  it('follows an incoming message only if the reader is at the end', () => {
    expect(nearChatBottom(950, 300, 1270)).toBe(true)
    expect(nearChatBottom(100, 300, 1270)).toBe(false)
    expect(chatScrollTop({ previousCount: 80, count: 81, previousNewestId: 'old', newestId: 'old', nearBottom: true, scrollHeight: 3100, restore: null })).toBe(3100)
    expect(chatScrollTop({ previousCount: 80, count: 81, previousNewestId: 'old', newestId: 'old', nearBottom: false, scrollHeight: 3100, restore: null })).toBeNull()
  })

  it('retains reading position when 80 older messages are prepended', () => {
    expect(chatScrollTop({
      previousCount: 80, count: 160, previousNewestId: 'old', newestId: 'old', nearBottom: false,
      scrollHeight: 5500, restore: { top: 90, height: 2500 },
    })).toBe(3090)
  })

  it('follows a full sliding page when the newest message ID changes without changing the count', () => {
    expect(chatScrollTop({
      previousCount: 80, count: 80, previousNewestId: 'm80', newestId: 'm81',
      nearBottom: true, scrollHeight: 2500, restore: null,
    })).toBe(2500)
    expect(chatScrollTop({
      previousCount: 80, count: 80, previousNewestId: 'm80', newestId: 'm81',
      nearBottom: false, scrollHeight: 2500, restore: null,
    })).toBeNull()
  })

  it('does not scroll on a no-op poll', () => {
    expect(chatScrollTop({ previousCount: 80, count: 80, previousNewestId: 'old', newestId: 'old', nearBottom: true, scrollHeight: 2500, restore: null })).toBeNull()
  })
})
