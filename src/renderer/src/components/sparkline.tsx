import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Tiny trend line for stat tiles. With `max` the scale starts at zero (CPU, players);
 * without it the line is fitted to the series' own range so steady values sit mid-height.
 */
export function Sparkline({
  values,
  max,
  className,
  height = 32
}: {
  values: number[]
  max?: number
  className?: string
  height?: number
}) {
  const id = useId()
  const n = 60
  const series = values.slice(-n)
  if (series.length < 3 || series.every((v) => v === 0)) return <div style={{ height }} />

  const width = 120
  const peak = Math.max(...series)
  const floor = Math.min(...series)
  let lo = 0
  let hi = Math.max(max ?? 0, peak)
  if (max === undefined) {
    const pad = (peak - floor || peak || 1) * 0.6
    lo = Math.max(0, floor - pad)
    hi = peak + pad
  }
  if (hi <= lo) hi = lo + 1

  const step = width / (n - 1)
  const offset = (n - series.length) * step
  const inset = 3
  const pts = series.map((v, i) => [offset + i * step, height - inset - ((v - lo) / (hi - lo)) * (height - inset * 2)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('block w-full overflow-visible text-fg-subtle', className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
