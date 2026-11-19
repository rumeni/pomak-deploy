import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))

import type { Target } from './api'
import { targetOn } from './target'

const target = (valid_from: string, kcal: number): Target => ({
  valid_from, kcal, mode: 'manual', protein_g: null, carbs_g: null, fat_g: null, method: '', inputs: null, explanation: null, created_at: '',
})

describe('targetOn', () => {
  // Server vraća ciljeve od najnovijeg
  const list = [target('2026-10-10', 1900), target('2026-09-30', 2100)]

  it('za dan važi poslednji cilj koji je počeo tog dana ili ranije', () => {
    expect(targetOn(list, '2026-09-30')?.kcal).toBe(2100)
    expect(targetOn(list, '2026-10-09')?.kcal).toBe(2100)
    expect(targetOn(list, '2026-10-10')?.kcal).toBe(1900)
  })

  it('pre prvog cilja nema cilja', () => {
    expect(targetOn(list, '2026-09-29')).toBeUndefined()
  })
})

describe('nutrition goals', () => {
  it('earlier targets show under the new goals', async () => {
    const { normalizeGoal, hasPace, PACES, GOALS } = await import('./api')
    expect(normalizeGoal('lose')).toBe('fat_loss')
    expect(normalizeGoal('maintain')).toBe('maintenance')
    expect(normalizeGoal('gain')).toBe('muscle_gain')
    expect(normalizeGoal('recomposition')).toBe('recomposition')
    expect(GOALS).toEqual(['fat_loss', 'muscle_gain', 'recomposition', 'maintenance'])
    // Same paces as the server; recomposition and maintenance have none.
    expect(PACES.fat_loss).toEqual([0.25, 0.5, 0.75, 1])
    expect(PACES.muscle_gain).toEqual([0.1, 0.25, 0.5])
    expect([hasPace('recomposition'), hasPace('maintenance'), hasPace('fat_loss')]).toEqual([false, false, true])
  })
})

describe('an accepted proposal that changed', () => {
  it('takes the server\'s newer proposal only from an estimate_changed answer', async () => {
    const { changedEstimate } = await import('./api')
    const estimate = { supported: false, reason: 'age' }
    expect(changedEstimate({ response: { status: 409, data: { code: 'estimate_changed', estimate } } })).toEqual(estimate)
    expect(changedEstimate({ response: { status: 409, data: { code: 'collaboration_changed' } } })).toBeNull()
    expect(changedEstimate({ response: { status: 400, data: {} } })).toBeNull()
    expect(changedEstimate(null)).toBeNull()
  })
})

describe('proposal lifecycle', () => {
  it('clears the replacement proposal on edit and accepts only a fresh calculation', async () => {
    const { emptyProposal, settleProposal } = await import('./proposalState')
    const old = { supported: false, reason: 'missing' } as const
    const fresh = { supported: false, reason: 'age' } as const
    let state = settleProposal(emptyProposal(1), 1, old, 'estimate_changed')
    expect(state.result).toEqual(old)
    state = emptyProposal(2)
    expect(state.result).toBeNull()
    expect(state.error).toBeNull()
    state = settleProposal(state, 2, fresh, null)
    expect(state.result).toEqual(fresh)
    expect(state.error).toBeNull()
    expect(settleProposal(state, 1, old, 'estimate_changed')).toBe(state)
  })

  it('does not restore a proposal or an error from a late response after editing', async () => {
    const { emptyProposal, settleProposal } = await import('./proposalState')
    const state = emptyProposal(3)
    expect(settleProposal(state, 2, { supported: false, reason: 'macros' }, 'estimate_changed')).toBe(state)
    expect(settleProposal(state, 2, null, 'network error')).toBe(state)
  })
})
