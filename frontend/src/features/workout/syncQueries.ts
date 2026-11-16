import type { SyncReport } from './outbox'

/** Completed uploads change weekly totals and goals; rejected requests do not. */
export function workoutQueriesAfterSync(report: Pick<SyncReport, 'sent' | 'rejected' | 'deleted'>): string[][] {
  const keys: string[][] = []
  if (report.sent || report.rejected || report.deleted) keys.push(['sessions'])
  if (report.sent || report.deleted) keys.push(['week'], ['goals'])
  return keys
}
