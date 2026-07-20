import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement>

export function ScrollArea({ className, ...props }: ScrollAreaProps) {
  return (
    <div
      className={cn(
        'scrollbar-subtle overflow-auto overscroll-contain',
        className,
      )}
      {...props}
    />
  )
}
