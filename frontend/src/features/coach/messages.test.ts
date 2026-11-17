import { describe, expect, it } from 'vitest'

import type { CoachMessage } from './api'
import { mergeCoachMessagePages } from './messages'

const message = (id: string, timestamp: string): CoachMessage => ({
  id, created_at: timestamp, sender_id: 'client1', text: id,
})

describe('coach message pagination', () => {
  it('prepends older pages chronologically while deduplicating overlaps and new posts', () => {
    const newest = [
      message('m79', '2026-11-16T09:00:00Z'),
      message('m80', '2026-11-16T10:00:00Z'),
    ]
    const older = [
      message('m01', '2026-11-15T09:00:00Z'),
      message('m79', '2026-11-16T09:00:00Z'),
    ]
    const newestAfterRefresh = [...newest, message('m81', '2026-11-16T11:00:00Z')]
    expect(mergeCoachMessagePages([newestAfterRefresh, older]).map((m) => m.id)).toEqual(['m01','m79','m80','m81'])
  })

  it('breaks exact timestamp ties by UUID-compatible ID ordering', () => {
    const date = '2026-11-16T09:00:00Z'
    const x = mergeCoachMessagePages([
      [message('000b', date), message('000a', date)],
      [message('000c', date), message('000a', date)],
    ])
    expect(x.map((m) => m.id)).toEqual(['000a','000b','000c'])
  })
})
