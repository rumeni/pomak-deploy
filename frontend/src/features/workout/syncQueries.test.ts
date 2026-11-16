import { describe, expect, it } from 'vitest'

import { workoutQueriesAfterSync } from './syncQueries'

describe('query refresh after workout sync', () => {
  it('refreshes weekly summary and goals after successful uploads', () => {
    expect(workoutQueriesAfterSync({ sent: 2, rejected: 0 })).toEqual([['sessions'], ['week'], ['goals']])
  })
  it('does not refresh weekly totals after rejected writes', () => {
    expect(workoutQueriesAfterSync({ sent: 0, rejected: 1 })).toEqual([['sessions']])
  })
  it('does nothing when there is no change', () => {
    expect(workoutQueriesAfterSync({ sent: 0, rejected: 0 })).toEqual([])
  })
})
