import { useEffect, useRef, useState, type PointerEvent } from 'react'

import { formatShortDate } from '../lib/format'
import { nearestIndex, plot, type ChartPoint } from './chart'

const PAD = 8

/**
 * Jednostavan linijski grafikon kroz vreme (SVG, prilagođava se širini ekrana).
 *
 * The SVG is drawn in its real pixel size (measured), so a pointer position maps 1:1 to the
 * chart: touch or hover picks the point under the finger / cursor and its value and date are
 * shown right above it.
 */
export function LineChart({ points, format, label, compact = false }: {
  points: ChartPoint[]
  format: (value: number) => string
  label: string
  /** Lower chart for small multiples. */
  compact?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [active, setActive] = useState<number | null>(null)
  const height = compact ? 80 : 160

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setWidth(Math.max(120, Math.round(el.getBoundingClientRect().width)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const innerW = width - PAD * 2
  const innerH = height - PAD * 2
  const { points: plotted } = plot(points, innerW, innerH)
  if (!plotted.length) return null
  const xy = plotted.map((p) => ({ ...p, x: p.x + PAD, y: p.y + PAD }))
  // Oznake su stvarna najveća i najmanja vrednost (grafikon ima malo prostora iznad i ispod njih).
  const max = Math.max(...points.map((p) => p.value))
  const min = Math.min(...points.map((p) => p.value))
  const path = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const first = xy[0]
  const last = xy[xy.length - 1]
  const hovered = active === null ? null : xy[active] ?? null

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setActive(nearestIndex(xy, e.clientX - rect.left))
  }

  // Near an edge the label is aligned to that edge instead of centred, so it is never cut off.
  const align = !hovered ? 'center' : hovered.x < 70 ? 'left' : hovered.x > width - 70 ? 'right' : 'center'

  return (
    <figure className="flex flex-col gap-1">
      {!compact && <div className="text-xs text-muted tabular-nums">{format(max)}</div>}
      <div ref={box} className="relative w-full">
        {hovered && (
          <div
            className={`pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs text-white shadow-md tabular-nums ${
              align === 'center' ? '-translate-x-1/2' : align === 'right' ? '-translate-x-full' : ''
            }`}
            style={{ left: align === 'left' ? Math.max(hovered.x - 8, 0) : align === 'right' ? Math.min(hovered.x + 8, width) : hovered.x, top: Math.max(hovered.y - 10, 0) }}
            role="status"
          >
            <span className="font-semibold">{format(hovered.value)}</span>
            <span className="text-white/70"> · {formatShortDate(hovered.date)}</span>
          </div>
        )}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-pan-y overflow-visible"
          role="img"
          aria-label={label}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
        >
          <line x1={PAD} y1={height - PAD} x2={width - PAD} y2={height - PAD} className="stroke-line" strokeWidth={1} />
          <line x1={PAD} y1={PAD} x2={width - PAD} y2={PAD} className="stroke-line" strokeWidth={1} strokeDasharray="4 4" />
          {hovered && <line x1={hovered.x} y1={PAD} x2={hovered.x} y2={height - PAD} className="stroke-muted/60" strokeWidth={1} />}
          <path d={path} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {xy.map((p, i) => (
            <circle key={`${p.date}-${i}`} cx={p.x} cy={p.y} r={i === active ? 6 : compact ? 3 : 4} className="fill-card stroke-accent" strokeWidth={2} />
          ))}
        </svg>
      </div>
      {min !== max && !compact && <div className="text-xs text-muted tabular-nums">{format(min)}</div>}
      <figcaption className="flex justify-between text-xs text-muted tabular-nums">
        <span>{formatShortDate(first.date)}</span>
        {xy.length > 1 && <span>{formatShortDate(last.date)}</span>}
      </figcaption>
    </figure>
  )
}
