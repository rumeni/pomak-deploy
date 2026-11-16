import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import { goalAlreadySavedConflict } from './goalRetry'

function apiError(status: number) {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    data: {}, status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
  })
}

describe('goal conflict recovery', () => {
  it('only treats HTTP 409 as a saved-goal conflict', () => {
    expect(goalAlreadySavedConflict(apiError(409))).toBe(true)
    expect(goalAlreadySavedConflict(apiError(400))).toBe(false)
    expect(goalAlreadySavedConflict(apiError(500))).toBe(false)
    expect(goalAlreadySavedConflict(new Error('offline'))).toBe(false)
  })
})
