import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))

import { instructionsFor } from './inboxApi'

const data = {
  connection_id: 'c1',
  results: [{ exercise_id: 'e1', exercise_name: 'Bench', text: 'Lopatice skupljene', updated_at: '2026-11-18T10:00:00Z' }],
}

describe('the athlete sees instructions only from his current coach', () => {
  it('shows them for the collaboration the app knows, or while it does not know yet', () => {
    expect(instructionsFor(data, 'c1').get('e1')).toBe('Lopatice skupljene')
    expect(instructionsFor(data, undefined).get('e1')).toBe('Lopatice skupljene')
  })

  it('hides the old coach guidance once the app knows of an end or a new collaboration', () => {
    expect(instructionsFor(data, null).size).toBe(0)
    expect(instructionsFor(data, 'c2').size).toBe(0)
    expect(instructionsFor({ connection_id: null, results: [] }, 'c1').size).toBe(0)
  })
})
