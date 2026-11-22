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
  /** Opt-in: the BMI number is always shown, its category only when this is on. Older servers omit it. */
  show_bmi_category?: boolean
}

export interface Me {
  id: string
  email: string
  email_verified?: boolean
  email_verification_required?: boolean
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
