/**
 * Reads the nutrition table of a package from OCR text (no AI, nothing leaves the phone).
 *
 * Tables list one nutrient per row, one column per amount: "Masti 2,8 g 5,6 g". Which column
 * is per 100 g (or 100 ml) is read from the header ("na 100 g | na porciju 30 g"); a table with
 * only per-serving columns is not filled at all, and without a readable header the first
 * column is used but flagged so the athlete double-checks it.
 * Labels in the region come in Serbian, Croatian, Bosnian, Slovenian and English, often all
 * at once, so the row is recognised by keyword stems with diacritics removed. Sub-rows
 * ("od toga zasićene masti", "of which sugars") are skipped so they never replace the
 * total. The result is only a pre-fill: the athlete checks it against the package.
 */

export type LabelField = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'

export interface LabelValues {
  values: Partial<Record<LabelField, string>>
  /** Fields recognised on the label, in table order. */
  found: LabelField[]
  /**
   * per100: the header names the per-100 g/ml column and it was used; assumed: no header was
   * readable, the first column was used; servingOnly: only per-serving values, nothing filled.
   */
  column: 'per100' | 'assumed' | 'servingOnly'
  /** The table is per 100 ml (drinks). */
  perMl: boolean
}

/** "na 100 g", "per 100ml", "100 g": the reference column. */
const PER_100 = /\b100\s*(g|ml)\b/
/** Any column header: per 100 g/ml, a serving or an amount ("na porciju (200 g)", "per 30 g"). */
const COLUMN_HEADER = /(\b100\s*(?:g|ml)\b|porcij\w*|serving|portion|obrok\w*|komad\w*|\b\d{1,4}\s*(?:g|ml)\b)/g

/**
 * Index of the per-100 column among the table's columns, from the header line. Markers close to
 * each other ("na porciju (200 g)") belong to the same column.
 */
function columnOf100(lines: string[]): { index: number; perMl: boolean } | 'servingOnly' | null {
  let sawServing = false
  for (const line of lines) {
    // The header comes before the first nutrient row; rows themselves have amounts like "2,8 g".
    if (/(energ|kalorij|kcal)/.test(line) || ROWS.some((r) => r.keys.test(line))) break
    if (!/(100\s*(g|ml)\b|porcij|serving|portion|obrok|komad)/.test(line)) continue
    const markers = [...line.matchAll(COLUMN_HEADER)]
    if (!markers.length) continue
    // "100 g" is always its own column. A serving word and the amount right next to it
    // ("porciju (200 g)", "30 g porcija") are one column; any other marker starts a new one.
    const columns: { at: number; per100: boolean; ml: boolean; word: boolean; amount: boolean }[] = []
    for (const m of markers) {
      const per100 = PER_100.test(m[0])
      const word = !per100 && !/\d/.test(m[0])
      const amount = !per100 && !word
      const last = columns[columns.length - 1]
      const near = !!last && !last.per100 && m.index! - last.at < 16
      if (near && amount && last.word && !last.amount) last.amount = true
      else if (near && word && last.amount && !last.word) last.word = true
      else columns.push({ at: m.index!, per100, ml: per100 && m[0].includes('ml'), word, amount })
    }
    const index = columns.findIndex((c) => c.per100)
    if (index >= 0) return { index, perMl: columns[index].ml }
    if (columns.length && /(porcij|serving|portion|obrok|komad)/.test(line)) sawServing = true
  }
  return sawServing ? 'servingOnly' : null
}

const KJ_PER_KCAL = 4.184

/** Lowercase without diacritics, common OCR slips fixed ("keal" for kcal, "O,5" for 0,5). */
function normalise(line: string): string {
  return line
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'dj')
    .replace(/\bk[ce][ae][l1i|]\b/g, 'kcal')
    .replace(/\bk[jl]\b/g, 'kj')
    .replace(/(\d)\s*[,.]\s*(\d)/g, '$1,$2')
    .replace(/(^|\s)o(?=,\d)/g, (_, space: string) => `${space}0`)
    .replace(/(\d)\s?[gq]\b/g, '$1 g')
    // "4,6 g" read as "4,69g": the g became a 9. Labels give one decimal (two only below 1 g).
    .replace(/\b([1-9]\d*,\d)9 g\b/g, '$1 g')
}

const ROWS: { field: Exclude<LabelField, 'kcal'>; keys: RegExp }[] = [
  { field: 'fat_g', keys: /\b(mast|masti|masnoc|mascob|fat|fett)/ },
  { field: 'carbs_g', keys: /(ugljen|ugljik|ugljikohidr|hidrat|carbohydr|ogljikov|kohlenhydr)/ },
  { field: 'fiber_g', keys: /(vlakn|vlakno|fibre|fiber|vlaknin|ballast)/ },
  { field: 'protein_g', keys: /(protein|belancevin|bjelancevin|beljakovin|eiweiss)/ },
]

/** Sub-rows of fat and carbohydrates: never the total. */
const SUB_ROW = /(zasicen|zasic|saturat|nasicen|secer|sugar|zucker|sladkor|poliol|polyol|skrob|starch|od toga|of which|od tega|davon)/

/** Numbers on a line ("2,8", "1046", "0.5"); "<0,5" counts as the number. */
function numbers(line: string): number[] {
  return [...line.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1].replace(',', '.')))
}

function energy(line: string, column: number): number | null {
  // "1046 kJ / 250 kcal", "250 kcal", "energija 1046 kj 250 kcal". One kcal value per column,
  // also when OCR dropped a "kcal" ("255 kJ/61 | 510 kJ / 122 kcal").
  // Keyed by where the number itself starts, so "502 kJ / 120 kcal" (found by both patterns)
  // counts once.
  const byPosition = new Map<number, number>()
  for (const m of line.matchAll(/(\d+(?:,\d+)?)\s*kcal/g)) byPosition.set(m.index!, Number(m[1].replace(',', '.')))
  for (const m of line.matchAll(/kj\s*[/|]\s*(\d+(?:,\d+)?)/g)) {
    byPosition.set(m.index! + m[0].length - m[1].length, Number(m[1].replace(',', '.')))
  }
  const candidates = [...byPosition.entries()].sort((a, b) => a[0] - b[0]).map(([, kcal]) => kcal)
  if (candidates.length) return candidates[column] ?? null
  const kj = [...line.matchAll(/(\d+(?:,\d+)?)\s*kj/g)][column]
  if (kj) return Number(kj[1].replace(',', '.')) / KJ_PER_KCAL
  return null
}

function format(value: number, decimals: number): string {
  return String(Math.round(value * 10 ** decimals) / 10 ** decimals)
}

export function parseLabelText(text: string): LabelValues {
  const values: LabelValues['values'] = {}
  const found: LabelField[] = []
  const lines = text.split(/\r?\n/).map(normalise).filter((l) => l.trim())
  const header = columnOf100(lines)
  // Only per-serving values: converting needs the serving size, so leave it to the athlete.
  if (header === 'servingOnly') return { values, found, column: 'servingOnly', perMl: false }
  const column = header?.index ?? 0

  lines.forEach((line, i) => {
    if (values.kcal === undefined && /(energ|kalorij|kcal|kj\b)/.test(line)) {
      // Energy can wrap: "Energetska vrednost" on one line, "1046 kJ / 250 kcal" on the next.
      const value = energy(line, column) ?? (lines[i + 1] ? energy(lines[i + 1], column) : null)
      if (value !== null && value > 0 && value <= 900) {
        values.kcal = format(value, 0)
        found.push('kcal')
      }
      return
    }
    if (SUB_ROW.test(line)) return
    for (const { field, keys } of ROWS) {
      if (values[field] !== undefined || !keys.test(line)) continue
      // The per-100 column's number after the keyword.
      const after = line.slice(line.search(keys))
      const value = numbers(after)[column]
      if (value !== undefined && value <= 100) {
        values[field] = format(value, 1)
        found.push(field)
      }
      break
    }
  })
  return { values, found, column: header ? 'per100' : 'assumed', perMl: header?.perMl ?? false }
}
