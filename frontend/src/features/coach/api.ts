import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import type { CoachTask } from './tasks'

export interface Connection {
  id: string
  coach: { id: string; name: string }
  client: { id: string; name: string }
  share_measurements: boolean
  share_nutrition: boolean
  // Older servers did not send it; treat missing as not shared.
  share_readiness?: boolean
  /** The coach may set the client's nutrition target (its own consent). */
  coach_sets_nutrition?: boolean
  // Server-made: +1 on every consent change and on the end (see access.ts).
  access_version?: number
  connected_at: string
  // Older servers did not send these; treat missing as an active collaboration.
  status?: 'active' | 'paused' | 'ended'
  ended_at?: string | null
  ended_by?: 'coach' | 'client' | null
}

export interface ClientRow extends Connection {
  last_workout_at: string | null
  workouts_7d: number
  open_tasks: number
  unread_messages?: number
}

/** What the client lets the coach see beyond workouts; each is its own revocable consent. */
export interface Sharing {
  share_measurements: boolean
  share_nutrition: boolean
  share_readiness: boolean
  coach_sets_nutrition: boolean
}

export interface CoachInvitation {
  id: string
  code: string
  expires_at: string
  label?: string
}

export type Specialty = 'strength' | 'hypertrophy' | 'weight_loss' | 'general_fitness' | 'beginners' | 'mobility' | 'injury_recovery' | 'sport' | 'seniors' | 'women'
export type WorkMode = 'in_person' | 'online' | 'both'

/** What a client sees about a coach. Qualifications are self-reported. */
export interface CoachCard {
  id: string
  name: string
  years_experience: number | null
  specialties: Specialty[]
  qualifications: string
  bio: string
  work_mode: WorkMode | ''
  gym_name: string
  city: string
  address: string
  /** Version of the profile picture, or null without one. */
  photo?: string | null
}

export interface CoachProfile {
  id?: string
  photo?: string | null
  name: string
  years_experience: number | null
  specialties: Specialty[]
  qualifications: string
  bio: string
  work_mode: WorkMode | ''
  gym_name: string
  city: string
  address: string
  completed_at: string | null
  specialty_choices: Specialty[]
}

export interface CoachNote {
  id: string
  text: string
  visible_to_client: boolean
  created_at: string
  updated_at: string
}

export interface Conversation extends Connection {
  last_message: CoachMessage | null
  unread?: number
}

export interface CoachAssignment {
  id: string
  routine_id: string
  name: string
  assigned_at: string
}

export type CoachDashboard =
  | {
    role: 'coach'
    invitations: CoachInvitation[]
    clients: ClientRow[]
    archived_clients?: Connection[]
    profile_completed?: boolean
    workouts_today?: number
    server_time?: string
    unread_messages?: number
    /** Sessions today, and booking requests waiting for the coach. */
    bookings_today?: number
    booking_requests?: number
  }
  | {
    role: 'client'
    connection: Connection | null
    coach?: CoachCard | null
    shared_notes?: CoachNote[]
    assignments: CoachAssignment[]
    archived?: Connection[]
    unread_messages?: number
  }

export interface CoachClientDetails {
  connection: Connection
  workouts_30d: number
  recent_workouts: { id: string; name: string; started_at: string; finished_at: string; feeling: number | null; notes: string; readiness?: { score: number | null; answers: Record<string, number> } | null; exercises: { name: string; sets: { set_type: 'warmup' | 'working'; reps: number | null; weight_kg: string | null; duration_seconds: number | null; distance_m: number | null }[] }[] }[]
  goals: { kind: string; target_value: string; target_date: string | null }[]
  measurements: { kind: string; value: string; unit: string; measured_on: string }[] | null
  nutrition_days: {
    date: string
    kcal: string
    protein_g: string | null
    carbs_g: string | null
    fat_g: string | null
    protein_unknown: number
    carbs_unknown: number
    fat_unknown: number
  }[] | null
  assignments: CoachAssignment[]
}

export interface CoachMessage {
  id: string
  sender_id: string
  text: string
  created_at: string
  /** A comment on a workout (null for a plain message, or once the workout is deleted). */
  workout?: { id: string; name: string; started_at: string } | null
  /** A comment on a week's review: its Monday. */
  week_start?: string | null
  /** A picture sent with the message. */
  image?: { id: string } | null
}

const DASHBOARD = ['coach-dashboard']

export function useCoachDashboard() {
  return useQuery({
    queryKey: DASHBOARD,
    queryFn: async () => (await api.get<CoachDashboard>('/coach/dashboard/')).data,
    refetchInterval: 30000,
  })
}

export function useCoachClient(id: string | undefined) {
  return useQuery({
    queryKey: ['coach-client', id],
    queryFn: async () => (await api.get<CoachClientDetails>(`/coach/clients/${id}/`)).data,
    enabled: !!id,
    refetchInterval: 15000,
    retry: false,
  })
}

const CHAT_PAGE_SIZE = 80
type MessageCursor = { before: string; before_id: string } | null

/** Which conversation: the coach's with a client, the client's own, or any one (also archived) by ID. */
export type ChatTarget = { clientId?: string; connectionId?: string; workoutId?: string; weekStart?: string }

const chatKey = ({ clientId, connectionId, workoutId, weekStart }: ChatTarget) =>
  `${connectionId ? `c:${connectionId}` : clientId ?? 'own'}${workoutId ? `:w:${workoutId}` : ''}${weekStart ? `:k:${weekStart}` : ''}`
const chatParams = ({ clientId, connectionId, workoutId, weekStart }: ChatTarget) => ({
  ...(connectionId ? { connection_id: connectionId } : clientId ? { client_id: clientId } : {}),
  ...(workoutId ? { workout_id: workoutId } : {}),
  ...(weekStart ? { week: weekStart } : {}),
})

export function useCoachMessages(target: ChatTarget = {}, { live = true }: { live?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ['coach-messages', chatKey(target)],
    initialPageParam: null as MessageCursor,
    queryFn: async ({ pageParam }) =>
      (await api.get<CoachMessage[]>('/coach/messages/', {
        params: { ...chatParams(target), ...(pageParam ?? {}) },
      })).data,
    // Each page is chronological, so its FIRST message is the oldest.
    getNextPageParam: (page) => page.length < CHAT_PAGE_SIZE ? undefined : {
      before: page[0].created_at, before_id: page[0].id,
    },
    // An archive never changes, so it is not polled.
    refetchInterval: live ? 15000 : false,
    retry: false,
  })
}

export function useCreateCoachInvite() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (label: string = '') => (await api.post<CoachInvitation>('/coach/invitations/', { label })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD }),
  })
}

export function useRevokeCoachInvite() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => api.delete(`/coach/invitations/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD }),
  })
}

/** The client's cached meal plan belongs to one collaboration and its consent: forget it when either changes. */
export function forgetMyMealPlan(qc: QueryClient) {
  return qc.resetQueries({ queryKey: ['my-meal-plan'] })
}

export function useConnectCoach() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (data: { code: string } & Sharing) =>
      (await api.post<Connection>('/coach/connect/', data)).data,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: DASHBOARD }), forgetMyMealPlan(qc)]),
  })
}

export function useUpdateCoachSharing() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (data: Sharing) =>
      (await api.patch<Connection>('/coach/connection/', data)).data,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: DASHBOARD }), forgetMyMealPlan(qc)]),
  })
}

export function useDisconnectCoach() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (clientId?: string) => clientId ? api.delete(`/coach/clients/${clientId}/`) : api.delete('/coach/connection/'),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: DASHBOARD }),
        qc.invalidateQueries({ queryKey: ['coach-client'] }),
        qc.invalidateQueries({ queryKey: ['coach-messages'] }),
        qc.invalidateQueries({ queryKey: CONVERSATIONS }),
        qc.invalidateQueries({ queryKey: TASKS }),
        forgetMyMealPlan(qc),
      ])
    },
  })
}

export function useAssignCoachRoutine(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (routineId: string) =>
      (await api.post<CoachAssignment>(`/coach/clients/${clientId}/assign/`, { routine_id: routineId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach-client', clientId] }),
  })
}

export function useSendCoachMessage(target: ChatTarget = {}) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    // The client-made ID makes a retry after a lost response return the stored message, not a copy.
    mutationFn: async ({ id, text, image_id }: { id: string; text: string; image_id?: string | null }) =>
      (await api.post<CoachMessage>('/coach/messages/', { id, text, ...(image_id ? { image_id } : {}), ...chatParams(target) })).data,
    onSuccess: () => Promise.all([
      // A comment shows in the conversation and with the workout: refresh both.
      qc.invalidateQueries({ queryKey: ['coach-messages'] }),
      qc.invalidateQueries({ queryKey: CONVERSATIONS }),
      ...(target.workoutId ? [qc.invalidateQueries({ queryKey: ['coach-client-workout'] })] : []),
    ]),
  })
}

const PROFILE = ['coach-profile']
const TASKS = ['coach-tasks']
const CONVERSATIONS = ['coach-conversations']

export function useCoachProfile(enabled = true) {
  return useQuery({
    queryKey: PROFILE,
    queryFn: async () => (await api.get<CoachProfile>('/coach/profile/')).data,
    enabled,
  })
}

export type CoachProfileInput = Partial<Omit<CoachProfile, 'name' | 'completed_at' | 'specialty_choices'>> & { complete?: boolean }

export function useSaveCoachProfile() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: CoachProfileInput) => (await api.put<CoachProfile>('/coach/profile/', body)).data,
    onSuccess: (profile) => {
      qc.setQueryData(PROFILE, profile)
      // Right away, not after a refetch: the coach space must not send the coach back to the questions.
      qc.setQueryData<CoachDashboard>(DASHBOARD, (old) =>
        old?.role === 'coach' ? { ...old, profile_completed: !!profile.completed_at } : old)
      return qc.invalidateQueries({ queryKey: DASHBOARD })
    },
  })
}

/** Who an invite code belongs to; asked before the client accepts. */
export function useInvitePreview(code: string | null) {
  return useQuery({
    queryKey: ['coach-invite-preview', code],
    queryFn: async () => (await api.get<{ coach: CoachCard; expires_at: string }>('/coach/invitations/preview/', { params: { code } })).data,
    enabled: !!code,
    retry: false,
  })
}

export function useCoachTasks() {
  return useQuery({
    queryKey: TASKS,
    queryFn: async () => (await api.get<CoachTask[]>('/coach/tasks/')).data,
    refetchInterval: 60000,
  })
}

export type TaskAction = { action: 'done' | 'reopen' } | { action: 'snooze'; days: 1 | 3 | 7 }

export function useTaskAction() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, ...body }: TaskAction & { id: string }) => (await api.patch<CoachTask>(`/coach/tasks/${id}/`, body)).data,
    onSuccess: (task) => {
      qc.setQueryData<CoachTask[]>(TASKS, (old) => old?.map((t) => (t.id === task.id ? task : t)))
      return qc.invalidateQueries({ queryKey: DASHBOARD })
    },
  })
}

export function useClientStatus(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (status: 'active' | 'paused') => (await api.patch<Connection>(`/coach/clients/${clientId}/`, { status })).data,
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: DASHBOARD }),
      qc.invalidateQueries({ queryKey: ['coach-client', clientId] }),
      qc.invalidateQueries({ queryKey: TASKS }),
    ]),
  })
}

export function useConversations() {
  return useQuery({
    queryKey: CONVERSATIONS,
    queryFn: async () => (await api.get<Conversation[]>('/coach/conversations/')).data,
    refetchInterval: 30000,
  })
}

const notesKey = (connectionId: string) => ['coach-notes', connectionId]

export function useCoachNotes(connectionId: string | undefined) {
  return useQuery({
    queryKey: notesKey(connectionId ?? ''),
    queryFn: async () => (await api.get<CoachNote[]>(`/coach/connections/${connectionId}/notes/`)).data,
    enabled: !!connectionId,
  })
}

export function useCreateCoachNote(connectionId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: { text: string; visible_to_client: boolean }) =>
      (await api.post<CoachNote>(`/coach/connections/${connectionId}/notes/`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey(connectionId) }),
  })
}

export function useUpdateCoachNote(connectionId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, ...body }: { id: string; text?: string; visible_to_client?: boolean }) =>
      (await api.patch<CoachNote>(`/coach/notes/${id}/`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey(connectionId) }),
  })
}

export function useDeleteCoachNote(connectionId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => api.delete(`/coach/notes/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey(connectionId) }),
  })
}
