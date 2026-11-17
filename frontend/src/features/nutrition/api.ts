import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import i18n from '../../i18n'
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
  source: 'usda' | 'custom' | 'recipe' | 'community'
  source_ref: string
  state: FoodState
  kcal: string
  protein_g: string | null
  carbs_g: string | null
  fat_g: string | null
  fiber_g: string | null
  portions: FoodPortion[]
  is_custom: boolean
  /** EAN/UPC from the package ('' if none); absent from older servers. */
  barcode?: string
  /** False for a community food an admin has not checked yet. */
  verified?: boolean
  /** The current user may change it (own food, or own unverified community food). */
  can_edit?: boolean
}

export type NewFood = Pick<Food, 'name' | 'state' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'portions'> & {
  id?: string
  barcode?: string
  /** Add to the shared database for everyone instead of keeping it private. */
  shared?: boolean
}

/** Values Open Food Facts has for a scanned barcode; shown in the form to confirm. */
export interface BarcodeSuggestion {
  name: string
  barcode: string
  kcal: string
  protein_g: string | null
  carbs_g: string | null
  fat_g: string | null
  fiber_g: string | null
  source: 'open_food_facts'
}

/** A scanned barcode: the food we already have, or a suggestion to confirm, or neither. */
export async function lookupBarcode(code: string): Promise<{ food: Food | null; suggestion: BarcodeSuggestion | null }> {
  return (await api.get(`/nutrition/foods/barcode/${code}/`, { timeout: 12000 })).data
}

export function useReportFood() {
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => api.post(`/nutrition/foods/${id}/report/`, { reason }),
  })
}

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['foods'] })
      void queryClient.invalidateQueries({ queryKey: ['recent-foods'] })
      void queryClient.invalidateQueries({ queryKey: ['recipes'] })
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
