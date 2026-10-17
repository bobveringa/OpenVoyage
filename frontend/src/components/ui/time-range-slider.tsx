import { formatDateTime, useClockFormat } from '@/lib/date-time'

import './time-range-slider.css'

type Props = {
  min: number
  max: number
  value: [number, number]
  disabled?: boolean
  onChange: (value: [number, number]) => void
}

/** Two keyboard/touch accessible native handles on one themed timeline. */
export function TimeRangeSlider({
  min,
  max,
  value,
  onChange,
  disabled,
}: Props) {
  const { preference } = useClockFormat()
  const labels = value.map((timestamp) =>
    formatDateTime(new Date(timestamp), { dateStyle: 'short', timeStyle: 'medium' }, preference),
  )
  const span = max - min || 1
  return (
    <div role="group" aria-label="Editing time range" className="space-y-1">
      <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
      </div>
      <div className="voyage-time-range relative mx-3 h-11">
        <div className="pointer-events-none absolute inset-x-0 top-5 h-1.5 rounded-full bg-muted" />
        <div
          className="pointer-events-none absolute top-5 h-1.5 rounded-full bg-primary"
          style={{
            left: `${((value[0] - min) / span) * 100}%`,
            right: `${100 - ((value[1] - min) / span) * 100}%`,
          }}
        />
        <input
          aria-label="Editing range start"
          aria-valuetext={labels[0]}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value[0]}
          disabled={disabled || min === max}
          onChange={(e) =>
            onChange([Math.min(Number(e.target.value), value[1]), value[1]])
          }
          style={{ zIndex: value[0] === max ? 3 : 1 }}
        />
        <input
          aria-label="Editing range end"
          aria-valuetext={labels[1]}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value[1]}
          disabled={disabled || min === max}
          onChange={(e) =>
            onChange([value[0], Math.max(Number(e.target.value), value[0])])
          }
          style={{ zIndex: 2 }}
        />
      </div>
    </div>
  )
}
