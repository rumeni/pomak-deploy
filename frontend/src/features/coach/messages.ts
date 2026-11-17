import type { CoachMessage } from './api'

/** Merge newest-first pages into one chronological conversation, no duplicates. */
export function mergeCoachMessagePages(pages: CoachMessage[][]): CoachMessage[] {
  const messages = new Map<string, CoachMessage>()
  for (const page of pages) for (const message of page) messages.set(message.id, message)
  return [...messages.values()].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )
}
