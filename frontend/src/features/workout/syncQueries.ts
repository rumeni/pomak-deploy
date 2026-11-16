import type { SyncReport } from './outbox'

/** Completed uploads change weekly totals and goals; rejected requests do not. */
export function workoutQueriesAfterSync(report: Pick<SyncReport, 'sent' | 'rejected'>): string[][] {
  const keys: string[][] = []
  if (report.sent || report.rejected) keys.push(['sessions'])
  if (report.sent) keys.push(['week'], ['goals'])
  return keys
}
