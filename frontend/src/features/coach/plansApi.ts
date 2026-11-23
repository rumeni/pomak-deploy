import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import type { ServerAccess } from './access'

/** 0 = Monday ... 6 = Sunday (as on the server). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

export interface ProgramTemplate {
  id: string
  name: string
  notes: string
  weeks: number | null
  days: { weekday: Weekday; routine: { id: string; name: string; archived: boolean } }[]
  updated_at: string
}

export interface TemplateInput {
  name: string
  notes: string
  weeks: number | null
  days: { weekday: Weekday; routine_id: string }[]
}

export interface PlanSet {
  set_type: 'warmup' | 'working'
  reps_min: number | null
  reps_max: number | null
  weight_kg: string | null
  duration_seconds: number | null
  distance_m: number | null
  rpe: string | null
}

/** A plan day: what was prescribed (frozen), and the client's routine to train with (null once gone). */
export interface PlanRoutine {
  id: string | null
  name: string
  exercises: {
    exercise_id: string
    name: string
    name_en: string
    measurement: string
    rest_seconds: number | null
    notes: string
    /** Missing in plan days frozen before supersets. */
    superset?: number | null
    sets: PlanSet[]
  }[]
}

export interface PlanVersion {
  id: string
  name: string
  reason: string
  valid_from: string
  valid_until: string | null
  weeks: number | null
  template_id: string | null
  created_at: string
  state: 'past' | 'current' | 'upcoming'
  days: { weekday: Weekday; routine: PlanRoutine | null }[]
}

/** The coach's view of a client's plan, with the access it was read under. */
export interface ClientPlanResponse {
  access: ServerAccess
  plan: ClientPlan | null
}

export interface ClientPlan {
  id: string
  today: { weekday: Weekday; routine: PlanRoutine | null } | null
  current_version_id: string | null
  versions: PlanVersion[]
}

/** One day of a plan change: keep a routine of the plan, copy one of the coach's, or a tailored one. */
export type PlanDayInput =
  | { weekday: Weekday; keep_routine_id: string }
  | { weekday: Weekday; routine_id: string }
  | { weekday: Weekday; routine: TailoredRoutine }

export interface TailoredRoutine {
  name: string
  notes: string
  exercises: { exercise_id: string; rest_seconds: number | null; notes: string; superset?: number | null; sets: PlanSet[] }[]
}

export interface PlanVersionInput {
  /** The collaboration the editor was opened for. */
  connection_id: string
  valid_from: string
  weeks: number | null
  name: string
  reason: string
  request_id: string
  days: PlanDayInput[]
}

const TEMPLATES = ['coach-templates']
const planKey = (clientId: string) => ['coach-client-plan', clientId]
const MY_PLAN = ['coach-my-plan']

export function useTemplates() {
  return useQuery({
    queryKey: TEMPLATES,
    queryFn: async () => (await api.get<ProgramTemplate[]>('/coach/templates/')).data,
  })
}

export function useSaveTemplate() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, body }: { id?: string; body: TemplateInput }) =>
      (id ? await api.put<ProgramTemplate>(`/coach/templates/${id}/`, body) : await api.post<ProgramTemplate>('/coach/templates/', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES }),
  })
}

export function useArchiveTemplate() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => api.delete(`/coach/templates/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES }),
  })
}

export interface AssignResult {
  results: { connection_id: string; client_id?: string; name?: string; ok: boolean; error?: string }[]
}

export function useAssignTemplate() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ templateId, ...body }: { templateId: string; connection_ids: string[]; start_date: string; reason: string; request_id: string }) =>
      (await api.post<AssignResult>(`/coach/templates/${templateId}/assign/`, body)).data,
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['coach-client-plan'] }),
      qc.invalidateQueries({ queryKey: ['coach-client'] }),
    ]),
  })
}

export function useClientPlan(clientId: string) {
  return useQuery({
    queryKey: planKey(clientId),
    queryFn: async () => (await api.get<ClientPlanResponse>(`/coach/clients/${clientId}/plan/`)).data,
    retry: false,
    // Notice a revoked collaboration while the screen is open.
    refetchInterval: 30_000,
  })
}

export function useSavePlanVersion(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: PlanVersionInput) => (await api.post<ClientPlanResponse>(`/coach/clients/${clientId}/plan/versions/`, body)).data,
    onSuccess: (plan) => {
      qc.setQueryData(planKey(clientId), plan)
      return qc.invalidateQueries({ queryKey: ['coach-client', clientId] })
    },
  })
}

/** The client's plan from his coach (null without one). */
export function useMyPlan(enabled: boolean) {
  return useQuery({
    queryKey: MY_PLAN,
    queryFn: async () => (await api.get<ClientPlan | null>('/coach/plan/')).data,
    enabled,
    staleTime: 60_000,
  })
}
