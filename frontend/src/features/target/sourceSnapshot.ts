import type { Profile } from '../../lib/types'
import type { WeightMeasurement } from './api'

type BodyData = Pick<Profile, 'sex' | 'birth_date' | 'height_cm'>
type WeightData = Pick<WeightMeasurement, 'id' | 'value' | 'measured_on'>

/** Detect an external data change before a long-open target form writes anything. */
export function sourceChanged(
  originalProfile: BodyData, originalWeight: WeightData | null,
  currentProfile: BodyData, currentWeight: WeightData | null,
): boolean {
  return originalProfile.sex !== currentProfile.sex
    || originalProfile.birth_date !== currentProfile.birth_date
    || Number(originalProfile.height_cm ?? 0) !== Number(currentProfile.height_cm ?? 0)
    || originalWeight?.id !== currentWeight?.id
    || originalWeight?.measured_on !== currentWeight?.measured_on
    || Number(originalWeight?.value ?? 0) !== Number(currentWeight?.value ?? 0)
}
