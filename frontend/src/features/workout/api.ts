import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import type { Exercise } from '../training/api'
import type { LoggedSet, PreviousPerformance, SessionPayload } from './model'
import { workoutQueriesAfterSync } from './syncQueries'

export interface WorkoutSession {
  id: string
  routine_id: string | null
  name: string
  started_at: string
  finished_at: string
  feeling: number | null
  notes: string
  exercises: { exercise: Exercise; notes: string; sets: LoggedSet[] }[]
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

export function useSession(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['sessions', id],
    queryFn: async () => (await api.get<WorkoutSession>(`/training/sessions/${id}/`)).data,
    enabled: !!id && enabled,
    retry: false,
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/training/sessions/${id}/`),
    onSuccess: () => Promise.all(
      workoutQueriesAfterSync({ sent: 0, rejected: 0, deleted: 1 }).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ),
  })
}
