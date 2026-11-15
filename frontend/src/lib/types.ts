export interface Profile {
  display_name: string
  language: 'sr-latn' | 'en'
  is_coach: boolean
  tracks_training: boolean
  tracks_nutrition: boolean
  onboarding_completed_at: string | null
  training_experience: '' | 'beginner' | 'intermediate' | 'advanced'
  weekly_workouts_target: number | null
  sex: '' | 'male' | 'female'
  birth_date: string | null
  height_cm: string | null
  meals: { key: string; name: string; enabled: boolean }[] | null
}

export interface Me {
  id: string
  email: string
  profile: Profile
}

export interface Measurement {
  id: string
  kind: 'weight' | 'waist' | 'chest' | 'hips' | 'arm' | 'thigh'
  value: string
  unit: string
  measured_on: string
  note: string
}
