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

/** The athlete's instructions from the coach he has now, by exercise. */
export function useMyInstructions(enabled: boolean) {
  return useQuery({
    queryKey: ['coach-my-instructions'],
    queryFn: async () => (await api.get<ExerciseInstruction[]>('/coach/instructions/')).data,
    enabled,
    staleTime: 5 * 60_000,
    select: (rows) => new Map(rows.map((r) => [r.exercise_id, r.text])),
  })
}
