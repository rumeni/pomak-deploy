import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import i18n from '../../i18n'
import { db } from '../../lib/db'
import { getCurrentUserId } from '../../lib/currentUser'
import { api } from '../../lib/api'

export type FoodState = 'raw' | 'cooked' | 'prepared' | 'na'

export interface FoodPortion {
  name: string
  grams: string
}

/** Namirnica; vrednosti su na 100 g. `null` znači nepoznato (nikad 0). */
export interface Food {
  id: string
  name: string
  aliases: string
  source: 'usda' | 'custom' | 'recipe'
  source_ref: string
  state: FoodState
  kcal: string
  protein_g: string | null
  carbs_g: string | null
  fat_g: string | null
  fiber_g: string | null
  portions: FoodPortion[]
  is_custom: boolean
}

export type NewFood = Pick<Food, 'name' | 'state' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'portions'>

export function useFoods(q: string) {
  return useQuery({
    // Nazivi zavise od jezika, pa je jezik deo ključa keša.
    queryKey: ['foods', i18n.language, q],
    queryFn: async () => (await api.get<Food[]>('/nutrition/foods/', { params: { q: q || undefined } })).data,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

export function useFood(id: string | undefined) {
  return useQuery({
    queryKey: ['foods', i18n.language, 'detail', id],
    queryFn: async () => (await api.get<Food>(`/nutrition/foods/${id}/`)).data,
    enabled: !!id,
  })
}

export function useCreateFood() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: NewFood) => (await api.post<Food>('/nutrition/foods/', body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foods'] }),
  })
}

/** Edit only the current user's custom food; the API rejects shared USDA and recipe edits. */
export function useUpdateFood() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: NewFood }) =>
      (await api.patch<Food>(`/nutrition/foods/${id}/`, body)).data,
    onSuccess: async (food) => {
      // Recent foods and the diary picker also read their own persisted copy
      // from IndexedDB. Update that copy before navigating away from editing.
      const ownerId = getCurrentUserId()
      if (ownerId) {
        const key = `${ownerId}:${food.id}`
        const cached = await db.foodCache.get(key)
        if (cached) await db.foodCache.put({ ...cached, food })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['foods'] }),
        queryClient.invalidateQueries({ queryKey: ['recent-foods'] }),
        queryClient.invalidateQueries({ queryKey: ['recipes'] }),
        queryClient.invalidateQueries({ queryKey: ['saved-meals'] }),
      ])
    },
  })
}

export function useDeleteFood() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/nutrition/foods/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foods'] }),
  })
}

export interface RecipeIngredient {
  food: Food
  grams: string
  portion_name: string
}

/** Recept je namirnica čije vrednosti server računa iz sastojaka i mase gotovog jela. */
export interface Recipe extends Pick<Food, 'id' | 'name' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'portions'> {
  mass_g: string | null
  servings: number
  raw_mass_g: string
  ingredients: RecipeIngredient[]
}

export interface RecipeBody {
  id: string
  name: string
  mass_g: string | null
  servings: number
  ingredients: { food_id: string; grams: string; portion_name: string }[]
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['recipes', i18n.language, id],
    queryFn: async () => (await api.get<Recipe>(`/nutrition/recipes/${id}/`)).data,
    enabled: !!id,
  })
}

/** Novi recept (POST sa ID-jem, bez duplikata pri ponovljenom slanju) ili izmena postojećeg. */
export function useSaveRecipe(isNew: boolean) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: RecipeBody) =>
      (isNew ? await api.post<Recipe>('/nutrition/recipes/', body) : await api.put<Recipe>(`/nutrition/recipes/${body.id}/`, body)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['foods'] })
      void queryClient.invalidateQueries({ queryKey: ['recipes'] })
      void queryClient.invalidateQueries({ queryKey: ['recent-foods'] })
    },
  })
}
