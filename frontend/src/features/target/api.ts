import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'

export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
export type Goal = 'lose' | 'maintain' | 'gain'
export type TargetMode = 'app' | 'manual' | 'coach'

export const ACTIVITIES: Activity[] = ['sedentary', 'light', 'moderate', 'active', 'very_active']
/** Ponuđeni tempi (% telesne mase nedeljno); isti kao na serveru (nutrition/targets.py). */
export const PACES: Record<Goal, number[]> = { lose: [0.25, 0.5, 0.75, 1], maintain: [0], gain: [0.1, 0.25, 0.5] }

export interface Explanation {
  bmr: number
  activity_factor: number
  tdee: number
  daily_adjustment: number
  weekly_change_kg: number
  floor: number
  protein_g_per_kg: number
  fat_share: number
}

export interface TargetInputs {
  sex: 'male' | 'female'
  age: number
  height_cm: number
  weight_kg: number
  weight_date: string
  activity: Activity
  goal: Goal
  pace: number
}

/** Kalorijski cilj koji važi od `valid_from` do sledećeg. Makroi su null kad ih korisnik nije postavio. */
export interface Target {
  valid_from: string
  mode: TargetMode
  kcal: number
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  method: string
  inputs: TargetInputs | null
  explanation: Explanation | null
  created_at: string
}

export type UnsupportedReason = 'age' | 'special_conditions' | 'missing' | 'below_floor' | 'macros'

export type Estimate =
  | ({ supported: true } & Pick<Target, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'method'> & { inputs: TargetInputs; explanation: Explanation })
  | { supported: false; reason: UnsupportedReason; missing?: string[]; floor?: number }

export interface EstimateChoices {
  activity: Activity
  goal: Goal
  pace: number
  special_conditions: boolean
}

export type TargetWrite =
  | ({ mode: 'app' } & EstimateChoices)
  | { mode: 'manual'; kcal: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null }

export function useTargets() {
  return useQuery({
    queryKey: ['targets'],
    queryFn: async () => (await api.get<Target[]>('/nutrition/targets/')).data,
  })
}

export async function estimateTarget(choices: EstimateChoices, validFrom: string): Promise<Estimate> {
  return (await api.post<Estimate>('/nutrition/targets/estimate/', { ...choices, valid_from: validFrom })).data
}

export function useSaveTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ validFrom, body }: { validFrom: string; body: TargetWrite }) =>
      (await api.put<Target>(`/nutrition/targets/${validFrom}/`, body)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['targets'] })
      // Cilj se prikazuje u dnevniku svakog dana od kog važi.
      void queryClient.invalidateQueries({ queryKey: ['diary'] })
    },
  })
}

export interface WeightMeasurement {
  id: string
  value: string
  measured_on: string
}

export function useLatestWeight() {
  return useQuery({
    queryKey: ['measurements', 'weight', 'latest'],
    queryFn: async () => (await api.get<WeightMeasurement[]>('/progress/measurements/', { params: { kind: 'weight' } })).data[0] ?? null,
  })
}
