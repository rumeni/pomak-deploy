import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import type { TrainingStats } from '../progress/stats'
import type { ServerAccess } from './access'
import type { CoachMessage } from './api'
import type { PlanSet } from './plansApi'

export interface ReviewSet {
  set_type: 'warmup' | 'working'
  reps: number | null
  weight_kg: string | null
  duration_seconds: number | null
  distance_m: number | null
  rpe: string | null
}

/** The plan the workout started with: the client's app sends it, so every field may be missing. */
export interface PlanSnapshot {
  name?: string
  exercises?: { exercise?: { id?: string; name?: string }; sets?: Partial<PlanSet>[] }[]
}

export interface ClientWorkout {
  access: ServerAccess
  /** Finished during this collaboration (only those are reviewed). */
  reviewable: boolean
  id: string
  name: string
  started_at: string
  finished_at: string
  feeling: number | null
  notes: string
  edited_at: string | null
  plan: PlanSnapshot | null
  exercises: { exercise_id: string; name: string; measurement: string; notes: string; sets: ReviewSet[] }[]
  readiness: { score: number | null; answers: Record<string, number> } | null
  reviewed_at: string | null
  comments: CoachMessage[]
}

export function useClientWorkout(clientId: string, workoutId: string) {
  return useQuery({
    queryKey: ['coach-client-workout', clientId, workoutId],
    queryFn: async () => (await api.get<ClientWorkout>(`/coach/clients/${clientId}/workouts/${workoutId}/`)).data,
    retry: false,
    refetchInterval: 30_000,
  })
}

export function useMarkReviewed(clientId: string, workoutId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async () => (await api.post<{ reviewed_at: string }>(`/coach/clients/${clientId}/workouts/${workoutId}/reviewed/`, {})).data,
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['coach-client-workout', clientId, workoutId] }),
      qc.invalidateQueries({ queryKey: ['coach-tasks'] }),
      qc.invalidateQueries({ queryKey: ['coach-dashboard'] }),
    ]),
  })
}

export function useClientStats(clientId: string, period: string) {
  return useQuery({
    queryKey: ['coach-client-stats', clientId, period],
    queryFn: async () => (await api.get<TrainingStats & { access: ServerAccess }>(`/coach/clients/${clientId}/stats/`, { params: { period } })).data,
    retry: false,
    refetchInterval: 30_000,
  })
}

export interface CoachTarget {
  valid_from: string
  mode: 'app' | 'manual' | 'coach'
  kcal: number
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  set_by_coach: boolean
  note: string
}

export interface ClientTargets {
  access: ServerAccess
  allowed: boolean
  can_set: boolean
  current: CoachTarget | null
  next: CoachTarget | null
}

export function useClientTargets(clientId: string) {
  return useQuery({
    queryKey: ['coach-client-targets', clientId],
    queryFn: async () => (await api.get<ClientTargets>(`/coach/clients/${clientId}/nutrition-target/`)).data,
    retry: false,
    refetchInterval: 30_000,
  })
}

export interface TargetInput {
  valid_from: string
  kcal: number
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  note: string
}

export function useSetClientTarget(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: TargetInput) => (await api.post<ClientTargets>(`/coach/clients/${clientId}/nutrition-target/`, body)).data,
    onSuccess: (data) => qc.setQueryData(['coach-client-targets', clientId], data),
  })
}
