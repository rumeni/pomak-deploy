import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import type { ServerAccess } from './access'

const UNREAD = ['coach-unread']

/** Unread messages in all of the user's conversations (the navigation badge). */
export function useUnreadTotal(enabled: boolean) {
  return useQuery({
    queryKey: UNREAD,
    queryFn: async () => (await api.get<{ total: number; by_connection: Record<string, number> }>('/coach/unread/')).data,
    enabled,
    refetchInterval: 30000,
    retry: false,
  })
}

/** Everything up to this message is read (the server cursor only moves forward). */
export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (messageId: string) =>
      (await api.post<{ connection_id: string; unread: number }>('/coach/messages/read/', { message_id: messageId })).data,
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: UNREAD }),
      qc.invalidateQueries({ queryKey: ['coach-conversations'] }),
      qc.invalidateQueries({ queryKey: ['coach-dashboard'] }),
    ]),
  })
}

export interface ExerciseInstruction {
  exercise_id: string
  exercise_name: string
  text: string
  updated_at: string
}

/** The coach's instructions for one client (coach side). */
export function useClientInstructions(clientId: string) {
  return useQuery({
    queryKey: ['coach-client-instructions', clientId],
    queryFn: async () =>
      (await api.get<{ access: ServerAccess; results: ExerciseInstruction[] }>(`/coach/clients/${clientId}/instructions/`)).data,
    retry: false,
  })
}

export function useSaveInstruction(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: { connection_id: string; exercise_id: string; text: string }) =>
      (await api.put<{ access: ServerAccess; results: ExerciseInstruction[] }>(`/coach/clients/${clientId}/instructions/`, body)).data,
    onSuccess: (data) => qc.setQueryData(['coach-client-instructions', clientId], data),
  })
}

/**
 * The athlete's instructions from the coach he has now, by exercise. Refreshed while training;
 * shown only for the collaboration the app currently knows (none after an end or a change).
 */
export function useMyInstructions(ownerId: string | null, currentConnectionId: string | null | undefined) {
  return useQuery({
    queryKey: ['coach-my-instructions', ownerId],
    queryFn: async () => (await api.get<{ connection_id: string | null; results: ExerciseInstruction[] }>('/coach/instructions/')).data,
    enabled: !!ownerId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    select: (data) => instructionsFor(data, currentConnectionId),
  })
}

/** By exercise; nothing when the app knows a different collaboration (ended or replaced). */
export function instructionsFor(
  data: { connection_id: string | null; results: ExerciseInstruction[] },
  currentConnectionId: string | null | undefined,
): Map<string, string> {
  if (currentConnectionId !== undefined && data.connection_id !== currentConnectionId) return new Map()
  return new Map(data.results.map((r) => [r.exercise_id, r.text]))
}
