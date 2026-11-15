import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import i18n from '../../i18n'
import { api } from '../../lib/api'
import type { SavedMealItem } from './model'

export interface SavedMeal {
  id: string
  name: string
  items: SavedMealItem[]
}

export function useSavedMeals() {
  return useQuery({
    queryKey: ['saved-meals', i18n.language],
    queryFn: async () => (await api.get<SavedMeal[]>('/nutrition/saved-meals/')).data,
    retry: false,
  })
}

export function useCreateSavedMeal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { id: string; name: string; items: Record<string, string | null>[] }) =>
      (await api.post<SavedMeal>('/nutrition/saved-meals/', body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-meals'] }),
  })
}

export function useDeleteSavedMeal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/nutrition/saved-meals/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-meals'] }),
  })
}
