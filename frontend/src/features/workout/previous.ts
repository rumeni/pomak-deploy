import { getCurrentUserId } from '../../lib/currentUser'
import { fetchPrevious } from './api'
import type { PreviousPerformance } from './model'
import { mergePrevious, pendingSessions, previousFromOutbox } from './outbox'

/** Prošli rezultat po vežbi: sa servera i iz neposlatih treninga na telefonu (noviji pobeđuje). */
export async function loadPrevious(exerciseIds: string[]): Promise<Record<string, PreviousPerformance>> {
  if (!exerciseIds.length) return {}
  const ownerId = getCurrentUserId()
  const [server, pending] = await Promise.all([fetchPrevious(exerciseIds), ownerId ? pendingSessions(ownerId) : []])
  return mergePrevious(server, previousFromOutbox(pending, exerciseIds))
}
