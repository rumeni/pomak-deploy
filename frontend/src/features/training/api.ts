import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import i18n from '../../i18n'
import { api } from '../../lib/api'

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'band' | 'other'
export type MeasurementType =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'weighted_bodyweight'
  | 'assisted_bodyweight'
  | 'duration'
  | 'distance_duration'
export type Muscle =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'legs'
  | 'glutes'
  | 'core'
  | 'full_body'
  | 'cardio'
export type SetType = 'warmup' | 'working'

export interface Exercise {
  id: string
  /** Samo zajednička biblioteka; po njemu se nalazi crtež vežbe. Nema ga u treninzima sačuvanim na telefonu pre 1.8. */
  slug?: string | null
  name: string
  aliases: string
  equipment: Equipment
  measurement: MeasurementType
  load_mode: 'total' | 'per_side'
  muscle: Muscle
  instructions: string
  is_custom: boolean
}

export interface RoutineSet {
  set_type: SetType
  reps_min: number | null
  reps_max: number | null
  weight_kg: string | null
  duration_seconds: number | null
  distance_m: number | null
  /** Target intensity; missing in routines saved before RPE existed. */
  rpe?: string | null
}

export interface RoutineExercise {
  exercise: Exercise
  rest_seconds: number | null
  notes: string
  sets: RoutineSet[]
}

export interface Routine {
  id: string
  name: string
  notes: string
  exercises: RoutineExercise[]
  created_at: string
  updated_at: string
}

export interface RoutinePayload {
  id?: string
  name: string
  notes: string
  exercises: (Omit<RoutineExercise, 'exercise'> & { exercise_id: string })[]
}

export type NewExercise = Pick<Exercise, 'name' | 'equipment' | 'measurement' | 'muscle' | 'load_mode'> & { id?: string }

export function useExercises(q: string, muscle: Muscle | '') {
  return useQuery({
    // Nazivi vežbi zavise od jezika, pa je jezik deo ključa keša.
    queryKey: ['exercises', i18n.language, q, muscle],
    queryFn: async () =>
      (await api.get<Exercise[]>('/training/exercises/', { params: { q: q || undefined, muscle: muscle || undefined } })).data,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

export function useCreateExercise() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: NewExercise) => (await api.post<Exercise>('/training/exercises/', body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
}

export function useRoutines() {
  return useQuery({
    queryKey: ['routines'],
    queryFn: async () => (await api.get<Routine[]>('/training/routines/')).data,
  })
}

export function useRoutine(id: string | undefined) {
  return useQuery({
    queryKey: ['routines', id],
    queryFn: async () => (await api.get<Routine>(`/training/routines/${id}/`)).data,
    enabled: !!id,
  })
}

export function useSaveRoutine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ isNew, body }: { isNew: boolean; body: RoutinePayload }) =>
      isNew
        ? (await api.post<Routine>('/training/routines/', body)).data
        : (await api.put<Routine>(`/training/routines/${body.id}/`, body)).data,
    onSuccess: (routine) => {
      queryClient.setQueryData(['routines', routine.id], routine)
      return queryClient.invalidateQueries({ queryKey: ['routines'], exact: true })
    },
  })
}

export function useDeleteRoutine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/training/routines/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routines'] }),
  })
}

export function useDuplicateRoutine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Routine>(`/training/routines/${id}/duplicate/`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routines'] }),
  })
}
