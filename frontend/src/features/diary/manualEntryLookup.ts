import type { DiaryDay, DiaryEntry } from './types'

/** A deep link to an absent entry must never silently turn into a create form. */
export function findManualEntryForEdit(
  entryId: string | null, day: Pick<DiaryDay, 'entries'> | undefined,
): DiaryEntry | undefined {
  if (!entryId) return undefined
  return day?.entries.find((entry) => entry.id === entryId)
}
