import type { SyncReport } from './outbox'

/** Completed uploads/deletes change history, weekly totals, goals and exercise records. */
export function workoutQueriesAfterSync(report: Pick<SyncReport, 'sent' | 'rejected' | 'deleted'>): string[][] {
  const keys: string[][] = []
  if (report.sent || report.rejected || report.deleted) keys.push(['sessions'])
  if (report.sent || report.deleted) keys.push(['week'], ['goals'], ['progress'])
  return keys
}
