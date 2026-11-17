export interface ChartPoint {
  /** "2026-09-30" */
  date: string
  value: number
}

export interface PlottedPoint extends ChartPoint {
  x: number
  y: number
}

const DAY_MS = 86_400_000

/** Redni broj dana; UTC, da dan sa promenom na letnje/zimsko vreme ne bi imao 23 ili 25 sati. */
function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/**
 * Tačke u koordinate grafikona širine `width` i visine `height`. Po x osi razmak prati stvarne
 * datume (pauza od dve nedelje izgleda kao pauza), po y osi opseg je od najmanje do najveće
 * vrednosti uz malo prostora, da i mala promena bude vidljiva.
 */
export function plot(points: ChartPoint[], width: number, height: number): { points: PlottedPoint[]; min: number; max: number } {
  if (!points.length) return { points: [], min: 0, max: 0 }
  const days = points.map((p) => dayNumber(p.date))
  const first = Math.min(...days)
  const span = Math.max(...days) - first
  const values = points.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  const pad = max === min ? Math.max(1, Math.abs(max) * 0.05) : (max - min) * 0.1
  min -= pad
  max += pad
  return {
    min,
    max,
    points: points.map((p, i) => ({
      ...p,
      x: span === 0 ? width / 2 : ((days[i] - first) / span) * width,
      y: height - ((p.value - min) / (max - min)) * height,
    })),
  }
}

/**
 * The bar to describe: the selected one while it still exists, otherwise the last (current)
 * one. Selection is kept by key, so switching to a shorter series never points past its end.
 */
export function pickBar<T extends { key: string }>(bars: T[], selectedKey: string | null): T | null {
  return bars.find((b) => b.key === selectedKey) ?? bars[bars.length - 1] ?? null
}

