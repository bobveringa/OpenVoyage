import { GripVertical, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Connection, Stop } from '@/pages/trip-detail/models'
import { getStayLeaveDateValue, getTravelModeIcon } from '@/pages/trip-detail/planning-utils'
import { getTravelModeLabel } from '@/pages/trip-detail/shared-utils'
import { clockChangeHint, travelLineSummary } from './stop-timeline-utils'
import type { useStopDrag } from './use-stop-drag'

// Both are being tried (spec section 6). Set either to false to go back to
// the wide "Add stop here" buttons or the full connection card.
export const SMALL_ADD_BUTTONS = true
export const SLIM_TRAVEL_LINE = true

/** The space between two stops: the timeline, a small + and the travel line. */
export function TimelineGap({
  addLabel,
  children,
  disabled,
  onAdd,
}: {
  addLabel: string
  children?: React.ReactNode
  disabled: boolean
  onAdd?: () => void
}) {
  return (
    <div className="grid grid-cols-[3.25rem_1fr] items-center gap-3 px-1">
      <div className="flex flex-col items-center">
        <span className="h-2 w-px bg-border" />
        {onAdd ? (
          <button
            aria-label={addLabel}
            className="grid size-6 place-items-center rounded-full border border-border bg-card text-primary shadow-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={onAdd}
            title={addLabel}
            type="button"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        ) : <span className="h-2 w-px bg-border" />}
        <span className="h-2 w-px bg-border" />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** "✈ 1,146 km · 1 hr 55 min +" with a "Time difference +1 h" divider below. Opens the editor. */
export function TravelLine({
  connection,
  disabled,
  fromStop,
  onEdit,
  toStop,
}: {
  connection: Connection
  disabled: boolean
  fromStop: Stop
  onEdit: (connectionId: string) => void
  toStop: Stop
}) {
  const modes = connection.segments.map((segment) => segment.intent.travel_mode)
  const ModeIcon = getTravelModeIcon(modes.includes('FLIGHT') ? 'FLIGHT' : modes[0] ?? 'CAR')
  const summary = travelLineSummary(connection)
  const clock = clockChangeHint(
    fromStop.location.timezone,
    toStop.location.timezone,
    getStayLeaveDateValue(fromStop.planned_start_date, fromStop.planned_nights),
  )
  const label = `${modes.map(getTravelModeLabel).join(' → ')} ${fromStop.title} to ${toStop.title}`
  return (
    <>
    <button
      aria-label={`${label}, ${summary}${clock ? `, ${clock}` : ''}`}
      className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      data-travel-line={connection.id}
      disabled={disabled}
      onClick={() => onEdit(connection.id)}
      title={label}
      type="button"
    >
      <ModeIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium">{summary}</span>
    </button>
    {clock ? (
      <div aria-hidden="true" className="flex items-center gap-2 px-2 pb-1 text-[11px] text-muted-foreground">
        <span className="flex-1 border-t border-dashed border-border" />
        <span className="whitespace-nowrap" data-time-zone-change={connection.id}>{clock}</span>
        <span className="flex-1 border-t border-dashed border-border" />
      </div>
    ) : null}
    </>
  )
}

export function DragHandle(props: ReturnType<ReturnType<typeof useStopDrag>['handleProps']>) {
  return (
    <button
      {...props}
      className={cn(
        'grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  )
}

export function DropIndicator() {
  return <div aria-hidden="true" className="mx-1 h-0.5 rounded-full bg-primary" data-drop-indicator="" />
}
