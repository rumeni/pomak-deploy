import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'

export interface WeekCheckIn {
  energy: number | null
  progress: number | null
  nutrition: number | null
  satisfaction: number | null
  hardest: string
  notes: string
  updated_at?: string
}

/** The week in review: its facts and the athlete's check-in. Null parts are not shared (coach) or not there. */
export interface WeekReview {
  week_start: string
  week_end: string
  workouts: { count: number; target: number | null }
  training: { sessions: number; working_sets: number; volume_kg: string; avg_rpe: string | null }
  plan: { planned: number } | null
  weight: { latest: string; latest_date: string; previous: string | null; change: string | null } | null
  nutrition: { complete_days: number; avg_kcal: string | null; avg_protein_g: string | null; avg_target_kcal: string | null } | null
  readiness: { avg_score: number; checkins: number } | null
  shared: { measurements: boolean; nutrition: boolean; readiness: boolean }
  check_in: WeekCheckIn | null
}

const weekKey = (monday: string) => ['week-review', monday]

export function useWeekReview(monday: string) {
  return useQuery({
    queryKey: weekKey(monday),
    queryFn: async () => (await api.get<WeekReview>(`/progress/weeks/${monday}/review/`)).data,
  })
}

export function useSaveCheckIn(monday: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: Omit<WeekCheckIn, 'updated_at'>) => (await api.put<WeekReview>(`/progress/weeks/${monday}/review/`, body)).data,
    onSuccess: (review) => qc.setQueryData(weekKey(monday), review),
  })
}

export function useClientWeek(clientId: string, monday: string) {
  return useQuery({
    queryKey: ['coach-client-week', clientId, monday],
    queryFn: async () => (await api.get<WeekReview>(`/coach/clients/${clientId}/weeks/${monday}/`)).data,
    retry: false,
  })
}
