import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import i18n from '../../i18n'
import { api } from '../../lib/api'
import type { Exercise } from '../training/api'
import type { LoggedSet } from '../workout/model'
import { goalAlreadySavedConflict } from './goalRetry'

export type RecordKey =
  | 'heaviest'
  | 'e1rm'
  | 'best_set_volume'
  | 'session_volume'
  | 'most_reps'
  | 'session_reps'
  | 'longest_duration'
  | 'longest_distance'

/** Lični rekord; `value` je tekst za težine ("80.00"), broj za ponavljanja/sekunde/metre. */
export interface PersonalRecord {
  value: string | number
  date: string
  session_id: string
  weight?: string
  reps?: number
}

export interface ExerciseProgress {
  exercise: Exercise
  records: Partial<Record<RecordKey, PersonalRecord>>
  chart: { metric: RecordKey; points: { date: string; value: string | number }[] }
  history: { session_id: string; name: string; started_at: string; sets: LoggedSet[] }[]
}

export interface PerformedExercise {
  exercise: Exercise
  last_performed: string
  sessions: number
}

export function usePerformedExercises() {
  return useQuery({
    queryKey: ['progress', 'exercises', i18n.language],
    queryFn: async () => (await api.get<PerformedExercise[]>('/training/progress/exercises/')).data,
  })
}

export function useExerciseProgress(id: string | undefined) {
  return useQuery({
    queryKey: ['progress', 'exercise', i18n.language, id],
    queryFn: async () => (await api.get<ExerciseProgress>(`/training/progress/exercises/${id}/`)).data,
    enabled: !!id,
  })
}

export type MeasurementKind = 'weight' | 'waist' | 'chest' | 'hips' | 'arm' | 'thigh'
export const MEASUREMENT_KINDS: MeasurementKind[] = ['weight', 'waist', 'chest', 'hips', 'arm', 'thigh']

export interface Measurement {
  id: string
  kind: MeasurementKind
  value: string
  unit: 'kg' | 'cm'
  measured_on: string
  note: string
  created_at: string
}

export function useMeasurements(kind: MeasurementKind) {
  return useQuery({
    queryKey: ['measurements', kind],
    queryFn: async () => (await api.get<Measurement[]>('/progress/measurements/', { params: { kind } })).data,
  })
}

/** Merenja menjaju i stanje ciljeva i nedeljni pregled. */
function invalidateBody(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['measurements', 'goals', 'week']) void queryClient.invalidateQueries({ queryKey: [key] })
}

export function useAddMeasurement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: Pick<Measurement, 'id' | 'kind' | 'value' | 'measured_on'>) =>
      (await api.post<Measurement>('/progress/measurements/', body)).data,
    onSuccess: () => invalidateBody(queryClient),
  })
}

export function useDeleteMeasurement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/progress/measurements/${id}/`),
    onSuccess: () => invalidateBody(queryClient),
  })
}

export type GoalKind = MeasurementKind | 'workouts_per_week'
export const GOAL_KINDS: GoalKind[] = ['weight', 'workouts_per_week', 'waist', 'chest', 'hips', 'arm', 'thigh']

export interface GoalState {
  /** Telesna mera: tekst ("82.00") ili null bez merenja; treninzi: broj ove nedelje. */
  current: string | number | null
  current_date: string | null
  /** 0–1 */
  progress: number
  reached: boolean
  recent_weeks?: { week_start: string; count: number; met: boolean }[]
}

export interface Goal {
  id: string
  kind: GoalKind
  start_value: string | null
  target_value: string
  start_date: string
  target_date: string | null
  status: 'active' | 'achieved' | 'abandoned'
  closed_on: string | null
  state: GoalState
  created_at: string
}

export function useGoals() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: async () => (await api.get<Goal[]>('/progress/goals/')).data,
  })
}

export function useCreateGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { id: string; kind: GoalKind; target_value: string; start_value: string | null; target_date: string | null }) =>
      (await api.post<Goal>('/progress/goals/', body)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] })
      // Polazna vrednost bez ranijeg merenja postaje prvo merenje.
      void queryClient.invalidateQueries({ queryKey: ['measurements'] })
      void queryClient.invalidateQueries({ queryKey: ['week'] })
    },
    onError: (e) => {
      if (goalAlreadySavedConflict(e)) {
        void queryClient.invalidateQueries({ queryKey: ['goals'] })
      }
    },
  })
}

export function useCloseGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'achieved' | 'abandoned' }) =>
      (await api.post<Goal>(`/progress/goals/${id}/close/`, { status })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] })
      void queryClient.invalidateQueries({ queryKey: ['week'] })
    },
  })
}

type DayStatus = 'in_progress' | 'complete' | 'incomplete'
type Macro = 'protein_g' | 'carbs_g' | 'fat_g'

export interface WeekOverview {
  week_start: string
  week_end: string
  workouts: { count: number; target: number | null }
  nutrition: {
    days: { date: string; status: DayStatus | null; entries: number; kcal: string | null }[]
    complete_days: number
    avg_kcal: string | null
    avg_target_kcal: string | null
  } & Record<`avg_${Macro}`, string | null> &
    Record<`${Macro}_unknown`, number>
  weight: { latest: string; latest_date: string; previous: string | null; previous_date: string | null; change: string | null } | null
}

export function useWeek(start: string) {
  return useQuery({
    queryKey: ['week', start],
    queryFn: async () => (await api.get<WeekOverview>('/progress/week/', { params: { start } })).data,
  })
}
