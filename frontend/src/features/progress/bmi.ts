/** BMI is a screening statistic, not a body-fat estimate or diagnosis. */
export type BmiCategory = 'underweight' | 'healthy' | 'overweight' | 'obesity1' | 'obesity2' | 'obesity3'
export interface BmiResult { value: number; category: BmiCategory }

function parseDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const day = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== iso ? null : day
}

export function adultBmi(weightKg: number, heightCm: number, birthDate: string | null, measuredOn: string): BmiResult | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isFinite(heightCm) || heightCm <= 0 || !birthDate) return null
  const birth = parseDay(birthDate)
  const measurement = parseDay(measuredOn)
  if (!birth || !measurement || birth > measurement) return null
  let age = measurement.getUTCFullYear() - birth.getUTCFullYear()
  if (measurement.getUTCMonth() < birth.getUTCMonth()
    || (measurement.getUTCMonth() === birth.getUTCMonth() && measurement.getUTCDate() < birth.getUTCDate())) age--
  // CDC adult categories are defined for ages 20 and up.
  if (age < 20) return null
  const value = Math.round(weightKg / (heightCm / 100) ** 2 * 10) / 10
  const category: BmiCategory = value < 18.5 ? 'underweight'
    : value < 25 ? 'healthy'
      : value < 30 ? 'overweight'
        : value < 35 ? 'obesity1'
          : value < 40 ? 'obesity2' : 'obesity3'
  return { value, category }
}
