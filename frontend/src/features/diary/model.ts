import type { DiaryOpRow } from '../../lib/db'
import type { Food } from '../nutrition/api'
import type { DayStatus, DiaryDay, DiaryEntry, EntryWrite, MealKey } from './types'

const VALUE_FIELDS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'] as const
type ValueField = (typeof VALUE_FIELDS)[number]

/** Deljenje celih brojeva sa zaokruživanjem "na paran" (kao Python Decimal na serveru). */
function divideHalfEven(numerator: number, denominator: number): number {
  const q = Math.floor(numerator / denominator)
  const r = numerator - q * denominator
  if (2 * r > denominator) return q + 1
  if (2 * r < denominator) return q
  return q % 2 === 0 ? q : q + 1
}

/**
 * per100 × grami / 100, tačno kao na serveru: kcal na 1 decimalu, makroi na 2.
 * Računa se u celim brojevima; 9,51 × 50 / 100 = 4,755 daje 4,76 (kao server), a ne 4,75
 * kako bi dao obični zapis decimala u JavaScript-u.
 */
function scale(per100: string | null, grams: number, field: ValueField): string | null {
  if (per100 === null) return null
  const decimals = field === 'kcal' ? 1 : 2
  const p = Math.round(Number(per100) * 100) // stotinke
  const g = Math.round(grams * 10) // desetine grama
  // p/100 × g/10 / 100 = p·g / 10^5; na `decimals` decimala: podeli sa 10^(5 − decimals)
  const scaled = divideHalfEven(p * g, 10 ** (5 - decimals))
  return (scaled / 10 ** decimals).toFixed(decimals)
}

export interface EntryDraft {
  body: EntryWrite
  /** Kako će stavka izgledati posle slanja; prikazuje se odmah, i bez interneta. */
  preview: DiaryEntry
}

/** Nova stavka iz namirnice: snimak vrednosti na 100 g iz trenutka unosa (AC-04). */
export function entryFromFood(
  id: string,
  date: string,
  meal: MealKey,
  food: Food,
  grams: number,
  portionName: string,
  now: Date,
): EntryDraft {
  const per100: Record<ValueField, string | null> = {
    kcal: food.kcal,
    protein_g: food.protein_g,
    carbs_g: food.carbs_g,
    fat_g: food.fat_g,
    fiber_g: food.fiber_g,
  }
  const preview: DiaryEntry = {
    id,
    date,
    meal,
    food_id: food.id,
    name: food.name,
    grams: grams.toFixed(1),
    portion_name: portionName,
    per100_kcal: per100.kcal,
    per100_protein_g: per100.protein_g,
    per100_carbs_g: per100.carbs_g,
    per100_fat_g: per100.fat_g,
    per100_fiber_g: per100.fiber_g,
    kcal: scale(per100.kcal, grams, 'kcal')!,
    protein_g: scale(per100.protein_g, grams, 'protein_g'),
    carbs_g: scale(per100.carbs_g, grams, 'carbs_g'),
    fat_g: scale(per100.fat_g, grams, 'fat_g'),
    fiber_g: scale(per100.fiber_g, grams, 'fiber_g'),
    created_at: now.toISOString(),
  }
  return { body: bodyFor(preview), preview }
}

/** Izmena količine/obroka postojeće stavke iz namirnice: računa se iz njenog snimka, ne iz namirnice. */
export function withAmount(entry: DiaryEntry, grams: number, portionName: string, meal: MealKey): EntryDraft {
  const preview: DiaryEntry = {
    ...entry,
    meal,
    grams: grams.toFixed(1),
    portion_name: portionName,
    kcal: scale(entry.per100_kcal, grams, 'kcal')!,
    protein_g: scale(entry.per100_protein_g, grams, 'protein_g'),
    carbs_g: scale(entry.per100_carbs_g, grams, 'carbs_g'),
    fat_g: scale(entry.per100_fat_g, grams, 'fat_g'),
    fiber_g: scale(entry.per100_fiber_g, grams, 'fiber_g'),
  }
  return { body: bodyFor(preview), preview }
}

/** Ručni unos (deklaracija, poznate vrednosti). Nepoznat makro ostaje null. */
export function manualEntry(
  id: string,
  date: string,
  meal: MealKey,
  name: string,
  values: Record<ValueField, string | null>,
  now: Date,
  existing?: DiaryEntry,
): EntryDraft {
  const preview: DiaryEntry = {
    id,
    date,
    meal,
    food_id: null,
    name,
    grams: null,
    portion_name: '',
    per100_kcal: null,
    per100_protein_g: null,
    per100_carbs_g: null,
    per100_fat_g: null,
    per100_fiber_g: null,
    kcal: Number(values.kcal).toFixed(1),
    protein_g: values.protein_g === null ? null : Number(values.protein_g).toFixed(2),
    carbs_g: values.carbs_g === null ? null : Number(values.carbs_g).toFixed(2),
    fat_g: values.fat_g === null ? null : Number(values.fat_g).toFixed(2),
    fiber_g: values.fiber_g === null ? null : Number(values.fiber_g).toFixed(2),
    created_at: existing?.created_at ?? now.toISOString(),
  }
  return { body: bodyFor(preview), preview }
}

export function isFromFood(entry: DiaryEntry): boolean {
  return entry.per100_kcal !== null
}

function bodyFor(e: DiaryEntry): EntryWrite {
  const fromFood = isFromFood(e)
  return {
    date: e.date,
    meal: e.meal,
    food_id: e.food_id,
    grams: fromFood ? e.grams : null,
    portion_name: e.portion_name,
    name: fromFood ? '' : e.name,
    kcal: fromFood ? null : e.kcal,
    protein_g: fromFood ? null : e.protein_g,
    carbs_g: fromFood ? null : e.carbs_g,
    fat_g: fromFood ? null : e.fat_g,
    fiber_g: fromFood ? null : e.fiber_g,
  }
}

export interface DisplayDay extends DiaryDay {
  /** Stavke sa izmenama koje još nisu poslate. */
  pendingIds: Set<string>
  /** Izmene koje je server odbio (id stavke -> poruka). */
  errors: Map<string, string>
  statusPending: boolean
}

/** Dan za prikaz: stanje sa servera (ako ga ima) + neposlate izmene, redom. */
export function applyOps(date: string, server: DiaryDay | null, ops: DiaryOpRow[]): DisplayDay {
  let entries = [...(server?.entries ?? [])]
  let status: DayStatus | null = server?.status ?? null
  const pendingIds = new Set<string>()
  const errors = new Map<string, string>()
  let statusPending = false
  for (const op of [...ops].sort((a, b) => a.seq - b.seq)) {
    if (op.type === 'status') {
      status = op.status
      statusPending = true
      continue
    }
    if (op.error) errors.set(op.entryId, op.error)
    pendingIds.add(op.entryId)
    if (op.type === 'upsert') {
      const i = entries.findIndex((e) => e.id === op.entryId)
      if (op.preview.date !== date) entries = entries.filter((e) => e.id !== op.entryId)
      else if (i >= 0) entries[i] = op.preview
      else entries.push(op.preview)
    } else {
      entries = entries.filter((e) => e.id !== op.entryId)
    }
  }
  return { date, status, entries, target: server?.target ?? null, pendingIds, errors, statusPending }
}

export interface MacroTotal {
  /** Zbir poznatih vrednosti. */
  value: number
  /** Koliko stavki nema ovu vrednost (nepoznato, nije uračunato kao 0). */
  unknown: number
}

export interface DayTotals {
  kcal: number
  protein: MacroTotal
  carbs: MacroTotal
  fat: MacroTotal
}

export function totals(entries: DiaryEntry[]): DayTotals {
  const macro = (field: 'protein_g' | 'carbs_g' | 'fat_g'): MacroTotal => ({
    value: Math.round(entries.reduce((sum, e) => sum + (e[field] === null ? 0 : Number(e[field])), 0) * 10) / 10,
    unknown: entries.filter((e) => e[field] === null).length,
  })
  return {
    kcal: Math.round(entries.reduce((sum, e) => sum + Number(e.kcal), 0)),
    protein: macro('protein_g'),
    carbs: macro('carbs_g'),
    fat: macro('fat_g'),
  }
}

function totalsOf(entry: DiaryEntry): Record<ValueField, string | null> {
  return { kcal: entry.kcal, protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g, fiber_g: entry.fiber_g }
}

/**
 * Kopija stavke u drugi dan/obrok (npr. "doručak od juče"). Stavka iz namirnice ostaje veza
 * na namirnicu; ako je namirnica u međuvremenu obrisana, kopira se kao ručni unos sa istim
 * vrednostima (server nema iz čega da napravi snimak).
 */
export function copyEntry(entry: DiaryEntry, id: string, date: string, meal: MealKey, now: Date): EntryDraft {
  if (isFromFood(entry) && entry.food_id) {
    const preview: DiaryEntry = { ...entry, id, date, meal, created_at: now.toISOString() }
    return { body: bodyFor(preview), preview }
  }
  return manualEntry(id, date, meal, entry.name, totalsOf(entry), now)
}

/** Stavka sačuvanog obroka (sa servera). */
export interface SavedMealItem {
  food: Food | null
  grams: string | null
  portion_name: string
  name: string
  kcal: string | null
  protein_g: string | null
  carbs_g: string | null
  fat_g: string | null
  fiber_g: string | null
}

/** Stavka sačuvanog obroka -> stavka dnevnika (namirnica daje tadašnje vrednosti). */
export function entryFromSavedItem(item: SavedMealItem, id: string, date: string, meal: MealKey, now: Date): EntryDraft | null {
  if (item.food && item.grams) return entryFromFood(id, date, meal, item.food, Number(item.grams), item.portion_name, now)
  if (item.kcal === null || !item.name) return null // stavka čija je namirnica obrisana
  return manualEntry(id, date, meal, item.name, { kcal: item.kcal, protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g, fiber_g: item.fiber_g }, now)
}

/** Stavka dnevnika -> telo stavke sačuvanog obroka. */
export function savedItemFromEntry(entry: DiaryEntry): Record<string, string | null> {
  if (isFromFood(entry) && entry.food_id) return { food_id: entry.food_id, grams: entry.grams, portion_name: entry.portion_name }
  return { name: entry.name, ...totalsOf(entry) }
}
