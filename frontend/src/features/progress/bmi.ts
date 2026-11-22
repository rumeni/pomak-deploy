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
  // Drop binary floating-point noise (77.76 kg / 1.8² must be exactly 24), then categorize the precise BMI.
  const rawBmi = Math.round(weightKg / (heightCm / 100) ** 2 * 1e6) / 1e6
  const category: BmiCategory = rawBmi < 18.5 ? 'underweight'
    : rawBmi < 25 ? 'healthy'
      : rawBmi < 30 ? 'overweight'
        : rawBmi < 35 ? 'obesity1'
          : rawBmi < 40 ? 'obesity2' : 'obesity3'
  // Truncate for display so the number never contradicts its category (24.975 shows 24.9, not 25).
  return { value: Math.floor(rawBmi * 10 + 1e-9) / 10, category }
}
