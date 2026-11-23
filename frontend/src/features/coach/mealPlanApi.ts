import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import i18n from '../../i18n'
import { api } from '../../lib/api'
import type { SavedMealItem } from '../diary/model'
import type { MealKey } from '../diary/types'
import type { ServerAccess } from './access'

/** One food of the coach's daily plan; the same shape as a saved meal's item, plus its meal. */
export type MealPlanItem = SavedMealItem & { meal: MealKey }

export interface ClientMealPlan {
  access: ServerAccess
  /** The client lets the coach guide nutrition (same consent as setting the target). */
  allowed: boolean
  updated_at: string | null
  items: MealPlanItem[]
}

export interface MyMealPlan {
  coach_name: string
  updated_at: string
  items: MealPlanItem[]
}

export interface MealPlanItemInput {
  meal: MealKey
  food_id: string
  grams: string
  portion_name: string
}

export function useClientMealPlan(clientId: string) {
  return useQuery({
    queryKey: ['coach-client-meal-plan', clientId, i18n.language],
    queryFn: async () => (await api.get<ClientMealPlan>(`/coach/clients/${clientId}/meal-plan/`)).data,
    retry: false,
    // Like the target: a consent change by the client shows up while the tab stays open.
    refetchInterval: 30_000,
  })
}

export function useSaveMealPlan(clientId: string) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: { connection_id: string; items: MealPlanItemInput[] }) =>
      (await api.put<ClientMealPlan>(`/coach/clients/${clientId}/meal-plan/`, body)).data,
    onSuccess: (data) => qc.setQueryData(['coach-client-meal-plan', clientId, i18n.language], data),
  })
}

/** The client's plan from his current coach (null: none, or nutrition not guided by the coach). */
export function useMyMealPlan(enabled: boolean) {
  return useQuery({
    queryKey: ['my-meal-plan', i18n.language],
    queryFn: async () => (await api.get<MyMealPlan | null>('/coach/meal-plan/')).data,
    enabled,
    retry: false,
    // Short: a consent change made on another device must not leave an old plan loggable for long.
    // On this device the coach mutations reset it at once (coach/api.ts).
    staleTime: 30_000,
  })
}
