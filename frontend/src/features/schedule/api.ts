import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import type { ServerAccess } from '../coach/access'

export type SessionMode = 'in_person' | 'online'
export type BookingStatus = 'requested' | 'confirmed' | 'declined' | 'cancelled'

export interface SessionType {
  id: string
  name: string
  duration_minutes: number
  mode: SessionMode
  archived: boolean
}

export interface Booking {
  id: string
  starts_at: string
  ends_at: string
  status: BookingStatus
  /** A request nobody answered before its time. */
  expired: boolean
  /** The type as it was when booked (editing a type never rewrites this). */
  session_type: { id: string | null; name: string; duration_minutes: number; mode: SessionMode }
  coach: { id: string; name: string }
  client: { id: string; name: string }
  connection_id: string
  note: string
  created_by: 'coach' | 'client'
  cancelled_by: 'coach' | 'client' | 'system' | null
  cancel_reason: string
  can_cancel: boolean
  /** The package this session uses, and whether a cancelled session still counts. */
  package: { id: string; name: string } | null
  charged: boolean
}

export interface SessionPackage {
  id: string
  name: string
  total: number
  used: number
  remaining: number
  adjustment: number
  valid_from: string
  expires_on: string | null
  note: string
  closed: boolean
  expired: boolean
  sessions: { id: string; starts_at: string; type_name: string; status: BookingStatus; charged: boolean }[]
}

export interface ScheduleSettings {
  auto_confirm: boolean
  cancel_hours: number
  min_notice_hours: number
  horizon_days: number
  slot_step_minutes: 15 | 30 | 60
}

export interface HoursWindow { weekday: number; start: string; end: string }

export interface ScheduleException {
  id: string
  kind: 'closed' | 'open'
  starts_at: string
  ends_at: string
  note: string
}

export interface CalendarData {
  time_zone: string
  from: string
  to: string
  bookings: Booking[]
  exceptions: ScheduleException[]
  hours: HoursWindow[]
  requests: number
}

export interface SlotsData {
  time_zone: string
  coach: { id: string; name: string }
  connection_id: string
  session_types: SessionType[]
  session_type_id: string | null
  auto_confirm: boolean
  cancel_hours: number
  slots: string[]
}

const CALENDAR = ['schedule-calendar']
const MINE = ['schedule-my']
const SLOTS = ['schedule-slots']
const PACKAGES = ['schedule-packages']

/** After any booking change: both sides' lists, free slots, package balances, the overview. */
function refreshBookings(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: CALENDAR }),
    qc.invalidateQueries({ queryKey: MINE }),
    qc.invalidateQueries({ queryKey: SLOTS }),
    qc.invalidateQueries({ queryKey: PACKAGES }),
    qc.invalidateQueries({ queryKey: ['coach-dashboard'] }),
  ])
}

// ---- the coach's setup ----

export function useScheduleSettings() {
  return useQuery({ queryKey: ['schedule-settings'], queryFn: async () => (await api.get<ScheduleSettings>('/schedule/settings/')).data })
}

export function useSaveScheduleSettings() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: ScheduleSettings) => (await api.put<ScheduleSettings>('/schedule/settings/', body)).data,
    onSuccess: (data) => qc.setQueryData(['schedule-settings'], data),
  })
}

export function useSessionTypes() {
  return useQuery({ queryKey: ['schedule-types'], queryFn: async () => (await api.get<SessionType[]>('/schedule/session-types/')).data })
}

export function useSaveSessionType() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, ...body }: { id?: string; name: string; duration_minutes: number; mode: SessionMode }) =>
      (id ? await api.put<SessionType>(`/schedule/session-types/${id}/`, body) : await api.post<SessionType>('/schedule/session-types/', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-types'] }),
  })
}

export function useArchiveSessionType() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => { await api.delete(`/schedule/session-types/${id}/`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-types'] }),
  })
}

export function useHours() {
  return useQuery({ queryKey: ['schedule-hours'], queryFn: async () => (await api.get<{ windows: HoursWindow[] }>('/schedule/hours/')).data })
}

export function useSaveHours() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (windows: HoursWindow[]) => (await api.put<{ windows: HoursWindow[] }>('/schedule/hours/', { windows })).data,
    onSuccess: (data) => Promise.all([qc.setQueryData(['schedule-hours'], data), qc.invalidateQueries({ queryKey: CALENDAR })]),
  })
}

export function useExceptions() {
  return useQuery({ queryKey: ['schedule-exceptions'], queryFn: async () => (await api.get<ScheduleException[]>('/schedule/exceptions/')).data })
}

export function useAddException() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: Omit<ScheduleException, 'id'>) =>
      (await api.post<ScheduleException & { conflicts: Booking[] }>('/schedule/exceptions/', body)).data,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['schedule-exceptions'] }), qc.invalidateQueries({ queryKey: CALENDAR })]),
  })
}

export function useDeleteException() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => { await api.delete(`/schedule/exceptions/${id}/`) },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['schedule-exceptions'] }), qc.invalidateQueries({ queryKey: CALENDAR })]),
  })
}

export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: [...CALENDAR, from, to],
    queryFn: async () => (await api.get<CalendarData>('/schedule/calendar/', { params: { from, to } })).data,
    refetchInterval: 30000,
  })
}

// ---- booking (both sides) ----

export function useSlots(sessionTypeId: string | null, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: [...SLOTS, sessionTypeId, from, to],
    queryFn: async () => (await api.get<SlotsData>('/schedule/slots/', { params: { from, to, ...(sessionTypeId ? { session_type: sessionTypeId } : {}) } })).data,
    enabled,
    retry: false,
  })
}

export function useMyBookings(enabled = true) {
  return useQuery({
    queryKey: MINE,
    queryFn: async () => (await api.get<{ upcoming: Booking[]; recent: Booking[]; past: Booking[] }>('/schedule/bookings/')).data,
    enabled,
    refetchInterval: 60000,
  })
}

export interface NewBooking {
  /** Made on the device and kept across a retry: a lost answer never books twice. */
  id: string
  session_type_id: string
  starts_at: string
  note: string
  /** The collaboration the form was made for: the coach's chosen client, or the client's slots. */
  connection_id: string
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: NewBooking) => (await api.post<Booking>('/schedule/bookings/', body)).data,
    onSettled: () => refreshBookings(qc),
  })
}

export function useBookingAction() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, action, reason = '', charge = false }: { id: string; action: 'confirm' | 'decline' | 'cancel'; reason?: string; charge?: boolean }) =>
      (await api.post<Booking>(`/schedule/bookings/${id}/${action}/`, { reason, charge })).data,
    onSettled: () => refreshBookings(qc),
  })
}

// ---- packages ----

export interface ClientPackages {
  access: ServerAccess
  connection_id: string
  packages: SessionPackage[]
}

/** A client's packages for his coach: guarded like other client data, refreshed while open. */
export function useClientPackages(clientId: string) {
  return useQuery({
    queryKey: [...PACKAGES, clientId],
    queryFn: async () => (await api.get<ClientPackages>(`/schedule/clients/${clientId}/packages/`)).data,
    refetchInterval: 30000,
    retry: false,
  })
}

/** Written into the cache only if it is still about the collaboration shown. */
function storeIfCurrent(qc: ReturnType<typeof useQueryClient>, clientId: string, data: ClientPackages) {
  qc.setQueryData<ClientPackages>([...PACKAGES, clientId], (old) => (!old || old.connection_id === data.connection_id ? data : old))
}

export function useAddPackage(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: { id: string; connection_id: string; name: string; total: number; valid_from: string; expires_on: string | null; note: string }) =>
      (await api.post<ClientPackages>(`/schedule/clients/${clientId}/packages/`, body)).data,
    onSuccess: (data) => storeIfCurrent(qc, clientId, data),
  })
}

export function useChangePackage(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, ...body }: { id: string; connection_id: string; adjustment?: number; expected_adjustment?: number; close?: boolean }) =>
      (await api.patch<ClientPackages>(`/schedule/clients/${clientId}/packages/${id}/`, body)).data,
    onSuccess: (data) => storeIfCurrent(qc, clientId, data),
    onError: () => qc.invalidateQueries({ queryKey: [...PACKAGES, clientId] }),
  })
}

/** The athlete's packages with his current coach, refreshed with his sessions. */
export function useMyPackages(ownerId: string | null) {
  return useQuery({
    queryKey: [...PACKAGES, 'mine', ownerId],
    queryFn: async () => (await api.get<{ connection_id: string; packages: SessionPackage[] }>('/schedule/packages/')).data,
    enabled: !!ownerId,
    refetchInterval: 60000,
    retry: false,
  })
}

/** Nothing when the app knows a different collaboration (ended or replaced). */
export function packagesFor(data: { connection_id: string; packages: SessionPackage[] } | undefined, currentConnectionId: string | null | undefined) {
  if (!data) return []
  if (currentConnectionId !== undefined && data.connection_id !== currentConnectionId) return []
  return data.packages
}
