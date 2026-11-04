import { Clock } from 'lucide-react'

import type { PostTimeLabels } from '@/lib/date-time'
import { cn } from '@/lib/utils'

/**
 * A post's time in the zone where it was posted ("local"), with the viewer's
 * own time underneath when their offset differs ("your time").
 *
 * - compact (desktop cards): two clock items, `🕓 14 Mar 2026, 14:05 GMT+9`
 *   and `🕓 06:05 your time`. They sit in the card's wrapping meta row, so
 *   "your time" moves to its own line when the row runs out of room.
 * - detail: `Sat 14 Mar, 14:05 GMT+9 · local time in Kyoto` / `06:05 · your time`
 * - preview (mobile story carousel): one line, `14:05 GMT+9`. That
 *   card must stay as tall as the flight summaries beside it, so it shows no
 *   date and no "your time"; both appear once the post is opened.
 *
 * Without a usable local zone (an old WebView, or a post the server hasn't
 * seen yet) only the viewer's time is shown, labelled "your time".
 */
export function PostTime({
  className,
  labels,
  locationName,
  variant,
}: {
  className?: string
  labels: PostTimeLabels
  locationName?: string
  variant: 'compact' | 'detail' | 'preview'
}) {
  const { local, viewer } = labels

  if (variant === 'preview') {
    return (
      <time className={cn('block min-w-0 truncate', className)} dateTime={labels.dateTime}>
        {local
          ? `${local.time} ${local.zone}`
          : `${viewer?.time ?? ''} your time`}
      </time>
    )
  }

  if (variant === 'compact') {
    const itemClassName = 'inline-flex items-center gap-1.5 whitespace-nowrap'
    const clock = <Clock className="size-3.5 shrink-0" aria-hidden="true" />
    return (
      <>
        <span className={cn(itemClassName, className)}>
          {clock}
          <time dateTime={labels.dateTime}>
            {local
              ? `${local.date}, ${local.time} ${local.zone}`
              : `${viewer?.date ?? ''}, ${viewer?.time ?? ''} your time`}
          </time>
        </span>
        {local && viewer ? (
          <span className={itemClassName}>
            {clock}
            <time dateTime={labels.dateTime}>
              {`${viewer.weekdayIfOtherDay ? `${viewer.weekdayIfOtherDay} ` : ''}${viewer.time} your time`}
            </time>
          </span>
        ) : null}
      </>
    )
  }

  const dateOf = (clock: { date: string; weekdayDate: string }) =>
    variant === 'detail' ? clock.weekdayDate : clock.date

  return (
    <time className={cn('grid min-w-0 gap-0.5', className)} dateTime={labels.dateTime}>
      {local ? (
        <span className="min-w-0">
          {`${dateOf(local)}, ${local.time} ${local.zone}`}
          <span className="text-muted-foreground/80">
            {' · '}
            {variant === 'detail' && locationName ? (
              <>
                local time in{' '}
                <span
                  className="inline-block max-w-[12rem] truncate align-bottom"
                  title={locationName}
                >
                  {locationName}
                </span>
              </>
            ) : variant === 'detail' ? 'local time' : 'local'}
          </span>
        </span>
      ) : null}
      {viewer ? (
        <span className={cn(local && 'text-muted-foreground/80')}>
          {local
            ? `${viewer.weekdayIfOtherDay ? `${viewer.weekdayIfOtherDay} ` : ''}${viewer.time}`
            : `${dateOf(viewer)}, ${viewer.time}`}
          {' · your time'}
        </span>
      ) : null}
    </time>
  )
}
