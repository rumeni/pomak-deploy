import { useState, type PointerEvent } from 'react'

import { formatShortDate } from '../lib/format'
import { plot, type ChartPoint } from './chart'

const W = 320
const H = 140

/**
 * Jednostavan linijski grafikon kroz vreme (SVG, prilagođava se širini ekrana).
 * Dodir ili prelazak mišem pokazuje najbližu tačku: vrednost i datum.
 */
export function LineChart({ points, format, label, compact = false }: {
  points: ChartPoint[]
  format: (value: number) => string
  label: string
  /** Lower chart for small multiples. */
  compact?: boolean
}) {
  const [active, setActive] = useState<number | null>(null)
  const { points: plotted } = plot(points, W, H)
  if (!plotted.length) return null
  // Oznake su stvarna najveća i najmanja vrednost (grafikon ima malo prostora iznad i ispod njih).
  const max = Math.max(...points.map((p) => p.value))
  const min = Math.min(...points.map((p) => p.value))
  const path = plotted.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const first = plotted[0]
  const last = plotted[plotted.length - 1]
  const hovered = active === null ? null : plotted[active]

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * (W + 12) - 6
    let nearest = 0
    for (let i = 1; i < plotted.length; i++) if (Math.abs(plotted[i].x - x) < Math.abs(plotted[nearest].x - x)) nearest = i
    setActive(nearest)
  }

  return (
    <figure className="flex flex-col gap-1">
      <div className="flex min-h-4 justify-between gap-2 text-xs text-muted tabular-nums" aria-live="polite">
        {hovered ? (
          <span className="font-semibold text-ink">
            {format(hovered.value)} <span className="font-normal text-muted">· {formatShortDate(hovered.date)}</span>
          </span>
        ) : (
          <span>{format(max)}</span>
        )}
      </div>
      <svg
        viewBox={`-6 -6 ${W + 12} ${H + 12}`}
        className={`${compact ? 'h-20' : 'h-40'} w-full touch-pan-y overflow-visible`}
        role="img"
        aria-label={label}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
      >
        <line x1={0} y1={H} x2={W} y2={H} className="stroke-line" strokeWidth={1} />
        <line x1={0} y1={0} x2={W} y2={0} className="stroke-line" strokeWidth={1} strokeDasharray="4 4" />
        {hovered && <line x1={hovered.x} y1={0} x2={hovered.x} y2={H} className="stroke-muted/50" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        <path d={path} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {plotted.map((p, i) => (
          <circle
            key={`${p.date}-${p.x}`}
            cx={p.x}
            cy={p.y}
            r={i === active ? 6 : compact ? 3 : 4}
            className="fill-card stroke-accent"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {min !== max && !compact && (
        <div className="flex justify-between text-xs text-muted tabular-nums">
          <span>{format(min)}</span>
        </div>
      )}
      <figcaption className="flex justify-between text-xs text-muted tabular-nums">
        <span>{formatShortDate(first.date)}</span>
        {plotted.length > 1 && <span>{formatShortDate(last.date)}</span>}
      </figcaption>
    </figure>
  )
}
