import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import { savedMealConflict } from './api'

function httpError(status: number) {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    data: {},
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  })
}

describe('saved meal retry errors', () => {
  it('recognizes HTTP 409 so an occupied retry UUID is released and saved meals refresh', () => {
    expect(savedMealConflict(httpError(409))).toBe(true)
    expect(savedMealConflict(httpError(400))).toBe(false)
    expect(savedMealConflict(httpError(500))).toBe(false)
    expect(savedMealConflict(new Error('offline'))).toBe(false)
  })
})
