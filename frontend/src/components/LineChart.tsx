import { formatShortDate } from '../lib/format'
import { plot, type ChartPoint } from './chart'

const W = 320
const H = 140

/** Jednostavan linijski grafikon kroz vreme (SVG, prilagođava se širini ekrana). */
export function LineChart({ points, format, label }: { points: ChartPoint[]; format: (value: number) => string; label: string }) {
  const { points: plotted } = plot(points, W, H)
  if (!plotted.length) return null
  // Oznake su stvarna najveća i najmanja vrednost (grafikon ima malo prostora iznad i ispod njih).
  const max = Math.max(...points.map((p) => p.value))
  const min = Math.min(...points.map((p) => p.value))
  const path = plotted.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const first = plotted[0]
  const last = plotted[plotted.length - 1]
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>{format(max)}</span>
      </div>
      <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} className="h-40 w-full overflow-visible" role="img" aria-label={label}>
        <line x1={0} y1={H} x2={W} y2={H} className="stroke-line" strokeWidth={1} />
        <line x1={0} y1={0} x2={W} y2={0} className="stroke-line" strokeWidth={1} strokeDasharray="4 4" />
        <path d={path} fill="none" className="stroke-brand" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {plotted.map((p) => (
          <circle key={`${p.date}-${p.x}`} cx={p.x} cy={p.y} r={4} className="fill-card stroke-brand" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {min !== max && (
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
