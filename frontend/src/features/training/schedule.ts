import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import type { Weekday } from '../coach/plansApi'

/** The athlete's own week: which routine on which weekday (0 = Monday); missing days are rest. */
export interface Schedule {
  days: { weekday: Weekday; routine_id: string; name: string }[]
}

const KEY = ['training-schedule']

export function useSchedule(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<Schedule>('/training/schedule/')).data,
    enabled,
    staleTime: 60_000,
  })
}

/** Saves the whole week at once (a repeated request changes nothing). */
export function useSaveSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (days: { weekday: Weekday; routine_id: string }[]) =>
      (await api.put<Schedule>('/training/schedule/', { days })).data,
    onSuccess: (schedule) => qc.setQueryData(KEY, schedule),
  })
}

/** Today's routine from the athlete's own week: the id, null on a rest day, undefined without a week. */
export function scheduledToday(schedule: Schedule | undefined, weekday: Weekday): string | null | undefined {
  if (!schedule?.days.length) return undefined
  return schedule.days.find((d) => d.weekday === weekday)?.routine_id ?? null
}
