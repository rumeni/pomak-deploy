import type { Estimate } from './api'

export interface ProposalState {
  generation: number
  result: Estimate | null
  error: string | null
}

export function emptyProposal(generation: number): ProposalState {
  return { generation, result: null, error: null }
}

/** A late estimate or save conflict belongs only to the form that sent it. */
export function settleProposal(current: ProposalState, generation: number, result: Estimate | null, error: string | null): ProposalState {
  return current.generation === generation ? { generation, result, error } : current
}
