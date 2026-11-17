import { useState } from 'react'

import { pickBar } from './chart'

export interface Bar {
  key: string
  /** Short label under the bar (e.g. "17. 11."). */
  label: string
  /** Full label in the tooltip (e.g. "Week of 17 November"). */
  title: string
  value: number
}

/**
 * Vertical bars for one measure over time (one hue, no legend: the title names it).
 * Tap or hover shows the exact value; the last bar (the current period) is drawn solid,
 * earlier ones lighter, so "now vs before" reads at a glance.
 */
export function BarChart({ bars, format, label }: { bars: Bar[]; format: (value: number) => string; label: string }) {
  // Selected by key, not index: a shorter series (another period) must not crash or mislabel.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const shown = pickBar(bars, activeKey)
  if (!shown) return null
  const max = Math.max(...bars.map((b) => b.value), 0)
  // Label every bar only when they fit; otherwise first, middle and last.
  const labelled = (i: number) => bars.length <= 8 || i === 0 || i === bars.length - 1 || i === Math.floor(bars.length / 2)

  return (
    <figure className="flex flex-col gap-2">
      <p className="min-h-5 text-sm tabular-nums" aria-live="polite">
        <span className="font-semibold">{format(shown.value)}</span>{' '}
        <span className="text-muted">· {shown.title}</span>
      </p>
      <div className="flex h-36 items-end gap-[2px]" role="img" aria-label={label} onPointerLeave={() => setActiveKey(null)}>
        {bars.map((bar, i) => {
          const height = max > 0 ? Math.max((bar.value / max) * 100, bar.value > 0 ? 3 : 0) : 0
          const current = i === bars.length - 1
          return (
            <button
              key={bar.key}
              type="button"
              aria-label={`${bar.title}: ${format(bar.value)}`}
              onPointerEnter={() => setActiveKey(bar.key)}
              onFocus={() => setActiveKey(bar.key)}
              onClick={() => setActiveKey(bar.key)}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className={`block w-full rounded-t-[4px] ${current ? 'bg-accent' : 'bg-accent/45'} ${bar.key === activeKey ? 'ring-2 ring-ink/70' : ''}`}
                style={{ height: `${height}%` }}
              />
            </button>
          )
        })}
      </div>
      <div className="flex gap-[2px] text-[10px] text-muted tabular-nums">
        {bars.map((bar, i) => (
          <span key={bar.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
            {labelled(i) ? bar.label : ''}
          </span>
        ))}
      </div>
    </figure>
  )
}
