import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

import { api } from '../../lib/api'
import type { Exercise } from '../training/api'
import type { LoggedSet, PreviousPerformance, SessionPayload } from './model'
import type { SessionEditPayload } from './edit'
import type { Readiness } from './rpe'
import { workoutQueriesAfterSync } from './syncQueries'
import { forgetCachedSession } from './historyCache'

export interface WorkoutSession {
  id: string
  routine_id: string | null
  name: string
  started_at: string
  finished_at: string
  feeling: number | null
  notes: string
  /** All nulls when the check-in was skipped; missing from servers older than this field. */
  readiness?: Readiness
  /** Revision for corrections; set when the athlete corrected the workout after finishing it. */
  updated_at?: string
  edited_at?: string | null
  /** `superset`: missing from servers and workouts older than supersets. */
  exercises: { exercise: Exercise; notes: string; superset?: number | null; sets: LoggedSet[] }[]
}

/** Poslednji rezultat po vežbi. Bez interneta vraća prazno: trening može da počne i tada. */
export async function fetchPrevious(exerciseIds: string[]): Promise<Record<string, PreviousPerformance>> {
  // Telefon zna da nema mreže: ne čekaj istek zahteva, trening kreće odmah.
  if (!exerciseIds.length || !navigator.onLine) return {}
  try {
    const { data } = await api.get<Record<string, PreviousPerformance>>('/training/sessions/previous/', {
      params: { exercise_ids: exerciseIds.join(',') },
      timeout: 5000,
    })
    return data
  } catch {
    return {}
  }
}

const SESSION_PAGE_SIZE = 50
type SessionCursor = { before: string; before_id: string } | null

/** Load history in stable keyset pages; existing API callers still get arrays. */
export function useSessions(ownerId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['sessions', ownerId],
    initialPageParam: null as SessionCursor,
    enabled: !!ownerId,
    queryFn: async ({ pageParam }) =>
      (await api.get<WorkoutSession[]>('/training/sessions/', { params: pageParam ?? undefined })).data,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < SESSION_PAGE_SIZE) return undefined
      const last = lastPage[lastPage.length - 1]
      return { before: last.started_at, before_id: last.id }
    },
  })
}

export function useSaveSession() {
  const queryClient = useQueryClient()
  return useMutation({
    // Isti ID pri ponovnom slanju: server vraća postojeći trening umesto duplikata.
    mutationFn: async (body: SessionPayload) => (await api.post<WorkoutSession>('/training/sessions/', body)).data,
    onSuccess: () => Promise.all(
      workoutQueriesAfterSync({ sent: 1, rejected: 0 }).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ),
  })
}

/** `latest`: always fetch on open, even with a recent cached copy (the edit form needs the newest). */
export function useSession(id: string | undefined, enabled: boolean, latest = false) {
  return useQuery({
    queryKey: ['sessions', id],
    queryFn: async () => (await api.get<WorkoutSession>(`/training/sessions/${id}/`)).data,
    enabled: !!id && enabled,
    retry: false,
    ...(latest ? { refetchOnMount: 'always' as const } : {}),
  })
}

/** The server refused a correction because the workout changed elsewhere since it was loaded. */
export class SessionEditConflict extends Error {
  readonly current: WorkoutSession

  constructor(current: WorkoutSession) {
    super('SESSION_EDIT_CONFLICT')
    this.current = current
  }
}

/** Corrects a finished workout. Online only: the result must be checked against the server. */
export function useEditSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: SessionEditPayload }) => {
      try {
        return (await api.put<WorkoutSession>(`/training/sessions/${id}/`, body)).data
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409 && error.response.data?.current) {
          throw new SessionEditConflict(error.response.data.current as WorkoutSession)
        }
        throw error
      }
    },
    onSuccess: (session) => {
      queryClient.setQueryData(['sessions', session.id], session)
      // History, weekly summary, goals and exercise progress all derive from set values.
      return Promise.all(
        workoutQueriesAfterSync({ sent: 1, rejected: 0 }).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      )
    },
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/training/sessions/${id}/`)
      await forgetCachedSession(id)
      return response
    },
    onSuccess: () => Promise.all(
      workoutQueriesAfterSync({ sent: 0, rejected: 0, deleted: 1 }).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ),
  })
}
