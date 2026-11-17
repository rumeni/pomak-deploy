/**
 * Reads the nutrition table of a package from OCR text (no AI, nothing leaves the phone).
 *
 * Tables list one nutrient per row, with the "per 100 g" value first: "Masti 2,8 g 5,6 g".
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

function energy(line: string): number | null {
  // "1046 kJ / 250 kcal", "250 kcal", "energija 1046 kj 250 kcal". The per-100 g value is the
  // first one on the line, also when OCR dropped its "kcal" ("255 kJ/61 | 510 kJ / 122 kcal").
  const candidates = [
    ...[...line.matchAll(/(\d+(?:,\d+)?)\s*kcal/g)].map((m) => ({ at: m.index!, kcal: Number(m[1].replace(',', '.')) })),
    ...[...line.matchAll(/kj\s*[/|]\s*(\d+(?:,\d+)?)/g)].map((m) => ({ at: m.index!, kcal: Number(m[1].replace(',', '.')) })),
  ].sort((a, b) => a.at - b.at)
  if (candidates.length) return candidates[0].kcal
  const kj = line.match(/(\d+(?:,\d+)?)\s*kj/)
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

  lines.forEach((line, i) => {
    if (values.kcal === undefined && /(energ|kalorij|kcal|kj\b)/.test(line)) {
      // Energy can wrap: "Energetska vrednost" on one line, "1046 kJ / 250 kcal" on the next.
      const value = energy(line) ?? (lines[i + 1] ? energy(lines[i + 1]) : null)
      if (value !== null && value > 0 && value <= 900) {
        values.kcal = format(value, 0)
        found.push('kcal')
      }
      return
    }
    if (SUB_ROW.test(line)) return
    for (const { field, keys } of ROWS) {
      if (values[field] !== undefined || !keys.test(line)) continue
      // First number after the keyword is the per-100 g column.
      const after = line.slice(line.search(keys))
      const value = numbers(after)[0]
      if (value !== undefined && value <= 100) {
        values[field] = format(value, 1)
        found.push(field)
      }
      break
    }
  })
  return { values, found }
}
