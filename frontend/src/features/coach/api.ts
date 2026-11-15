import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'

export interface Connection {
  id: string
  coach: { id: string; name: string }
  client: { id: string; name: string }
  share_measurements: boolean
  share_nutrition: boolean
  connected_at: string
}

export interface CoachInvitation {
  id: string
  code: string
  expires_at: string
}

export interface CoachAssignment {
  id: string
  routine_id: string
  name: string
  assigned_at: string
}

export type CoachDashboard =
  | { role: 'coach'; invitations: CoachInvitation[]; clients: Connection[] }
  | { role: 'client'; connection: Connection | null; assignments: CoachAssignment[] }

export interface CoachClientDetails {
  connection: Connection
  workouts_30d: number
  recent_workouts: { id: string; name: string; started_at: string; finished_at: string; feeling: number | null; notes: string; exercises: { name: string; sets: { reps: number | null; weight_kg: string | null; duration_seconds: number | null; distance_m: number | null }[] }[] }[]
  goals: { kind: string; target_value: string; target_date: string | null }[]
  measurements: { kind: string; value: string; unit: string; measured_on: string }[] | null
  nutrition_days: { date: string; kcal: string; protein_g: string | null; carbs_g: string | null; fat_g: string | null }[] | null
  assignments: CoachAssignment[]
}

export interface CoachMessage {
  id: string
  sender_id: string
  text: string
  created_at: string
}

const DASHBOARD = ['coach-dashboard']

export function useCoachDashboard() {
  return useQuery({
    queryKey: DASHBOARD,
    queryFn: async () => (await api.get<CoachDashboard>('/coach/dashboard/')).data,
  })
}

export function useCoachClient(id: string | undefined) {
  return useQuery({
    queryKey: ['coach-client', id],
    queryFn: async () => (await api.get<CoachClientDetails>(`/coach/clients/${id}/`)).data,
    enabled: !!id,
    retry: false,
  })
}

export function useCoachMessages(clientId?: string) {
  return useQuery({
    queryKey: ['coach-messages', clientId ?? 'own'],
    queryFn: async () => (await api.get<CoachMessage[]>('/coach/messages/', { params: clientId ? { client_id: clientId } : {} })).data,
    refetchInterval: 15000,
    retry: false,
  })
}

export function useCreateCoachInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => (await api.post<CoachInvitation>('/coach/invitations/')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD }),
  })
}

export function useRevokeCoachInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/coach/invitations/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD }),
  })
}

export function useConnectCoach() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { code: string; share_measurements: boolean; share_nutrition: boolean }) =>
      (await api.post<Connection>('/coach/connect/', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD }),
  })
}

export function useUpdateCoachSharing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { share_measurements: boolean; share_nutrition: boolean }) =>
      (await api.patch<Connection>('/coach/connection/', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD }),
  })
}

export function useDisconnectCoach() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientId?: string) => clientId ? api.delete(`/coach/clients/${clientId}/`) : api.delete('/coach/connection/'),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: DASHBOARD }),
        qc.invalidateQueries({ queryKey: ['coach-client'] }),
        qc.invalidateQueries({ queryKey: ['coach-messages'] }),
      ])
    },
  })
}

export function useAssignCoachRoutine(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (routineId: string) =>
      (await api.post<CoachAssignment>(`/coach/clients/${clientId}/assign/`, { routine_id: routineId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach-client', clientId] }),
  })
}

export function useSendCoachMessage(clientId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (text: string) =>
      (await api.post<CoachMessage>('/coach/messages/', { text, ...(clientId ? { client_id: clientId } : {}) })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach-messages', clientId ?? 'own'] }),
  })
}
