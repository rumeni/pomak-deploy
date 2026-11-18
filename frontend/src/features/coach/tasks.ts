/** Coach overview tasks: grouping for the list and the facts each one shows. */

export type TaskKind = 'workout_review' | 'inactive' | 'low_readiness' | 'personal_record' | 'weekly_checkin'
export type TaskState = 'open' | 'snoozed' | 'done'

export interface CoachTask {
  id: string
  kind: TaskKind
  state: TaskState
  snoozed_until: string | null
  resolved_at: string | null
  event_at: string
  data: {
    workout_id?: string
    workout?: string
    score?: number
    answers?: Record<string, number>
    records?: { exercise_id: string; exercise: string; exercise_en: string; e1rm: string }[]
    since?: string
    last_workout_at?: string | null
    week_start?: string
  }
  client: { id: string; name: string }
  /** The collaboration and access version it was read under (older servers did not send it). */
  connection?: { id: string; access_version: number; connected_at: string }
}

/** Open first (most recent event first), snoozed by when they come back, done by when closed. */
export function groupTasks(tasks: CoachTask[]): Record<TaskState, CoachTask[]> {
  const by = (state: TaskState) => tasks.filter((t) => t.state === state)
  const time = (value: string | null) => (value ? new Date(value).getTime() : 0)
  return {
    open: by('open').sort((a, b) => time(b.event_at) - time(a.event_at)),
    snoozed: by('snoozed').sort((a, b) => time(a.snoozed_until) - time(b.snoozed_until)),
    done: by('done').sort((a, b) => time(b.resolved_at) - time(a.resolved_at)),
  }
}

/** Whole days between two moments (for "no workouts for 9 days"), never negative. */
export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000))
}

/** The lift names of a record task in the app's language. */
export function recordNames(task: CoachTask, english: boolean): string[] {
  return (task.data.records ?? []).map((r) => (english && r.exercise_en ? r.exercise_en : r.exercise))
}
